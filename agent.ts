import "dotenv/config"
import {JoinNode, NodeContext, Workflow} from '@google/adk';
import { summaryAgent } from "./summary";
import { createNewsletter, newNewsletterId, Newsletter } from "./db/models/newsletter";
import { Timestamp } from "@google-cloud/firestore";
import { conceptExtractionAgent, conceptExtractionOutputSchema } from "./concept-extraction";
import { listConcepts } from "./db/models/concept";
import { conceptResolutionAgent, conceptResolutionOutputSchema, persistNewConcepts } from "./concept-resolution";

// async function ingest(_ctx: NodeContext, input: unknown) {
//   const newsletterText = typeof input == "string" ? input.trim() : ""
//   if (!newsletterText) {
//     throw new Error("newsletter content required.")
//   }
//   const {newsletter, quiz} = await ingestNewsletter(newsletterText)

//   return JSON.stringify({quizId: quiz.id, summary: newsletter.summary})
// }

// export const rootAgent = new Workflow({
//   name: "newsletter_agent",
//   description: "Ingest newletter: summarise, extract concepts and generate quiz. Returns quizId and summary as JSON",
//   edges: [ [ "START", ingest ] ]
// })

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

  return JSON.stringify({
    newsletterId: newsletter.id, 
    summary: newsletter.summary
  })
}

const join = new JoinNode({name: "join"})
async function result(_ctx: NodeContext, input: unknown) {
  const {persistNewsletter, concept_extraction_agent} = input as {
    persistNewsletter: {
      newsletterId: string, 
      summary: string,
    },
    concept_extraction_agent: {
      concepts: {
        label: string,
        evidence: string,
      }
    }
  }

  return JSON.stringify({ 
    ...persistNewsletter, 
    concept_extraction_agent 
  })
}

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

export const rootAgent = new Workflow({
  name: "newsletter_agent",
  description: "Ingest newletter: summarise, extract concepts and generate quiz. Returns quizId and summary as JSON",
  edges: [ 
    [ "START", [summaryAgent, conceptExtractionAgent]  ],
    [summaryAgent, persistNewsletter, join],
    [conceptExtractionAgent, buildInputForConceptResolutionAgent, conceptResolutionAgent, persistResolvedConcepts, join],
    [join, result]
  ]
})