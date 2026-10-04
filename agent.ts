import "dotenv/config"
import {BaseAgent, InvocationContext, LlmAgent, NodeContext, Workflow} from '@google/adk';
import { ingestNewsletter } from "./ingest";

async function ingest(_ctx: NodeContext, input: unknown) {
  const newsletterText = typeof input == "string" ? input.trim() : ""
  if (!newsletterText) {
    throw new Error("newsletter content required.")
  }
  const {newsletter, quiz} = await ingestNewsletter(newsletterText)

  return JSON.stringify({quizId: quiz.id, summary: newsletter.summary})
}

export const rootAgent = new Workflow({
  name: "newsletter_agent",
  description: "Ingest newletter: summarise, extract concepts and generate quiz. Returns quizId and summary as JSON",
  edges: [ [ "START", ingest ] ]
})
