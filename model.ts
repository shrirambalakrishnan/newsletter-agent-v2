import "dotenv/config"
import { Gemini } from "@google/adk"

// model calls go to their own location; the Agent Engine container sets
// GOOGLE_CLOUD_LOCATION to the deploy region, where the model is not served
export const model = new Gemini({
  model: process.env.GEMINI_MODEL ?? "gemini-3.6-flash",
  vertexai: true,
  project: process.env.GOOGLE_CLOUD_PROJECT,
  location: process.env.GEMINI_LOCATION ?? "global",
})
