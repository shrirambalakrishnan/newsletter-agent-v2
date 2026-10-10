import { randomUUID } from "node:crypto";
import {GoogleAuth} from "google-auth-library"

const AGENT_URL = process.env.AGENT_URL!

const auth = new GoogleAuth({scopes: 'https://www.googleapis.com/auth/cloud-platform'})

export interface AgentIngestResult {
  quizId: string
  summary: string
}

export async function ingestViaAgent(newsletterText: string): Promise<AgentIngestResult> {

  const headers : Record<string, string> = {"Content-Type": "application/json"}
  if(AGENT_URL.includes("googleapis.com"))  {
    headers.Authorization = `Bearer ${await auth.getAccessToken()}`
  }

  const res = await fetch(AGENT_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      input: {
        appName: "agent",
        userId: "cloudrun-ui",
        sessionId: randomUUID(),
        newMessage: { role: "user", parts: [ { text: newsletterText} ] }
      }
    })
  })

  if(!res.ok) {
    throw new Error(`agent call failed! ${await res.text()}`)
  }

  const body = await res.json()

  // one event per workflow node
  for (const event of body.output) {
    const output = JSON.stringify(event.output ?? event.content?.parts?.[0]?.text)
    console.log("NODE", event.author, "→", output?.slice(0, 100))
  }

  const lastEvent = body.output[body.output.length - 1]
  const text = lastEvent.content?.parts?.[0]?.text

  if(!text) {
    throw new Error("agent returned no result")
  }

  return JSON.parse(text) as AgentIngestResult
}