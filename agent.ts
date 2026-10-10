import "dotenv/config"
import {JoinNode, node, NodeContext, Workflow} from '@google/adk';
import { summaryAgent } from "./summary";
import { createNewsletter, newNewsletterId, Newsletter } from "./db/models/newsletter";
import { Timestamp } from "@google-cloud/firestore";
import { conceptExtractionAgent, conceptExtractionOutputSchema } from "./concept-extraction";
import { listConcepts } from "./db/models/concept";
import { conceptResolutionAgent, conceptResolutionOutputSchema, persistNewConcepts } from "./concept-resolution";
import z from "zod";
import { questionGenerationAgent, questionGenerationOutputSchema, toQuestions } from "./question-generation";
import { createQuestions } from "./db/models/question";
import { SEED_USER, setDefaultUser } from "./db/models/user";
import { createQuiz } from "./db/models/quiz";

const persistNewsletterNode = node(persistNewsletter, {name: "persist_newsletter"})
const buildInputForConceptResolutionAgentNode = node(buildInputForConceptResolutionAgent, {name: "build_input_for_concept_resolution_agent"})
const persistResolvedConceptsNode = node(persistResolvedConcepts, {name: "persist_resolved_concepts"})
const buildInputForQuestionGenerationAgentNode = node(buildInputForQuestionGenerationAgent, {name: "build_input_for_question_generation_agent"})
const persistQuizNode = node(persistQuiz, {name: "persist_quiz"})

async function persistNewsletter(ctx: NodeContext, input: unknown) {
  const parts = ctx.invocationContext.userContent?.parts ?? []
  const newsletterText = parts.map( p => p.text ?? "").join("").trim()
  
  const newsletter = {
    id: newNewsletterId(), 
    content: newsletterText, 
    summary: String(input), 
    createdAt: Timestamp.now()
  }

  await createNewsletter(newsletter)

  return {
    newsletterId: newsletter.id, 
    summary: newsletter.summary
  }
}

const join = new JoinNode({name: "join"})

async function buildInputForConceptResolutionAgent(_ctx: NodeContext, input: unknown) {
  const extraction = conceptExtractionOutputSchema.parse(input)
  const existingConcepts = await listConcepts()

  return {
    candidates: extraction.concepts,
    existingConcepts: existingConcepts.map( c => ({conceptId: c.conceptId, label: c.label}))
  }
}

async function persistResolvedConcepts(_ctx: NodeContext, input: unknown) {
  const resolutionResponse = conceptResolutionOutputSchema.parse(input)
  await persistNewConcepts(resolutionResponse.resolvedConcepts)

  return resolutionResponse
}

function newsletterTextOf(ctx: NodeContext): string {
  const parts = ctx.invocationContext.userContent?.parts ?? []
  return parts.map( p => p.text ?? "" ).join("").trim()
}

async function buildInputForQuestionGenerationAgent(ctx: NodeContext, input: unknown) {
  try{
    const {persist_newsletter: newsletter, persist_resolved_concepts: conceptsResolution} = input as {
      persist_newsletter: {
        newsletterId: string, 
        summary: string,
      },
      persist_resolved_concepts: z.infer<typeof conceptResolutionOutputSchema>
    }

    // persist_quiz needs these, but only receives the questions from the agent before it.
    // this is the last node that still has them as input, so they go to state here
    ctx.state.set("newsletter", newsletter)

    const conceptIds = conceptsResolution.resolvedConcepts.map( c => c.conceptId )
    ctx.state.set("conceptIds", conceptIds)

    return {
      newsletterContent: newsletterTextOf(ctx),
      concepts: conceptsResolution.resolvedConcepts.map( c => ( {conceptId: c.conceptId, label: c.label, evidence: c.evidence } ) )
    }
  } catch(e) {
    console.error(e)
    throw e
  }
}

async function persistQuiz(ctx: NodeContext, input: unknown) {

  const questionGenerationResponse = questionGenerationOutputSchema.parse(input)
  const newsletter = ctx.state.get<{newsletterId: string, summary: string}>("newsletter")!
  const conceptIds = ctx.state.get<string[]>("conceptIds")!
  const questions = toQuestions(questionGenerationResponse.questions, conceptIds)
  
  await createQuestions(questions)
  await setDefaultUser()

  const quiz = await createQuiz({
    newsletterContent: newsletterTextOf(ctx),
    questionIds: questions.map( q => q.id),
    userId: SEED_USER.id,
    newsletterId: newsletter.newsletterId
  })

  return JSON.stringify({quizId: quiz.id, summary: newsletter.summary})
}

export const rootAgent = new Workflow({
  name: "newsletter_agent",
  description: "Ingest newletter: summarise, extract concepts and generate quiz. Returns quizId and summary as JSON",
  edges: [ 
    [ "START", [summaryAgent, conceptExtractionAgent]  ],
    [summaryAgent, persistNewsletterNode, join],
    [conceptExtractionAgent, buildInputForConceptResolutionAgentNode, conceptResolutionAgent, persistResolvedConceptsNode, join],
    [join, buildInputForQuestionGenerationAgentNode, questionGenerationAgent, persistQuizNode]
  ]
})