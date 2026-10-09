import {z} from "zod"
import { conceptExtractionAgent, conceptExtractionOutputSchema } from "./concept-extraction"
import { runAgent, runAgentText } from "./run-agent"
import { listConcepts } from "./db/models/concept"
import { conceptResolutionAgent, conceptResolutionOutputSchema, persistNewConcepts, ResolvedConcept } from "./concept-resolution"
import { createQuiz, hashNewsletterContent, Quiz } from "./db/models/quiz"
import { questionGenerationAgent, questionGenerationOutputSchema, toQuestions } from "./question-generation"
import { createQuestions, Question } from "./db/models/question"
import { SEED_USER, setDefaultUser } from "./db/models/user"
import { rootAgent } from "./agent"
import { createNewsletter, newNewsletterId, Newsletter } from "./db/models/newsletter"
import { Timestamp } from "@google-cloud/firestore"
import { summaryAgent } from "./summary"

type ConceptResolutionOutputSchemaType = z.infer<typeof conceptResolutionOutputSchema>

export interface IngestResult {
  concepts: ResolvedConcept[]
  questions: Question[]
  quiz: Quiz
  newsletter: Newsletter
}

async function summariseNewsletter(newsletterText: string): Promise<Newsletter> {
  console.log("summariseNewsletter...")
  
  // step 0
  const summary = await runAgentText(
    summaryAgent,
    newsletterText,
  )
  console.log("summary generated")

  const newsletter = {
    id: newNewsletterId(), 
    content: newsletterText, 
    summary, 
    createdAt: Timestamp.now()
  }
  await createNewsletter(newsletter)

  console.log("summariseNewsletter done")
  return newsletter
}

async function resolveConcepts(newsletterText: string): Promise<ConceptResolutionOutputSchemaType> {
  console.log("resolveConcepts...")
  
  const extraction = await runAgent<z.infer<typeof conceptExtractionOutputSchema>>(
    conceptExtractionAgent,
    newsletterText,
  )
  console.log("candidates extracted = ", extraction.concepts )

  // step 2
  const existingConcepts = await listConcepts()
  
  // step 3
  const resolutionInput = JSON.stringify({
    candidates: extraction.concepts,
    existingConcepts: existingConcepts.map( c => ( { conceptId: c.conceptId, label: c.label} ))
  })

  const resolution = await runAgent<z.infer<typeof conceptResolutionOutputSchema>>(
    conceptResolutionAgent,
    resolutionInput,
  )
  console.log("resolved concepts = ", resolution.resolvedConcepts)

  // step 4
  await persistNewConcepts(resolution.resolvedConcepts)
  console.log("resolveConcepts done")

  return resolution
}

export async function ingestNewsletter(newsletterText: string): Promise<IngestResult> {
  console.log("ingestNewsletter...")

  const [newsletter, resolution] = await Promise.all([
    summariseNewsletter(newsletterText),
    resolveConcepts(newsletterText),
  ])

  // step 5
  const questionGenerationInput = JSON.stringify({
    newsletterContent: newsletterText,
    concepts: resolution
      .resolvedConcepts
      .map( c => {
        return { conceptId: c.conceptId, label: c.label, evidence: c.evidence }
      })
  })

  const questionGeneration = await runAgent<z.infer<typeof questionGenerationOutputSchema>>(
    questionGenerationAgent,
    questionGenerationInput,
  )
  console.log("questionGeneration count = ", questionGeneration.questions.length)

  // step 6
  const questions = toQuestions(
    questionGeneration.questions,
    resolution.resolvedConcepts.map( c => c.conceptId )
  )

  // step 7
  await createQuestions(questions)

  // step 8
  await setDefaultUser()

  const quiz = await createQuiz({
    newsletterContent: newsletterText,
    questionIds: questions.map(q => q.id),
    userId: SEED_USER.id,
    newsletterId: newsletter.id,
  })
  console.log("quiz created = ", quiz.id)

  return { newsletter,  concepts: resolution.resolvedConcepts, questions, quiz}
}