import "dotenv/config"
import { LlmAgent } from "@google/adk";
import { model } from "./model"
import {z} from "zod";
import { Concept, createConcepts, NEW_CONCEPT_DEFAULTS } from "./db/models/concept";

export const resolvedConceptSchema = z.object({
  label: z.string(),
  evidence: z.string(),
  action: z.enum(["reuse", "create"]),
  conceptId: z
    .string()
    .describe(
      "If action is reuse, the existing conceptId is matched. If action is create, new slug-style conceptId for this concept."
    )
})

export const conceptResolutionOutputSchema = z.object({
  resolvedConcepts: z.array(resolvedConceptSchema)
})

export type ResolvedConcept = z.infer<typeof resolvedConceptSchema>

export const conceptResolutionAgent = new LlmAgent({
  name: "concept_resolution_agent",
  model,
  description: "Decides whether extracted concepts match existing ones or are genuinely new",
  instruction: [
    "You will receive JSON object with two fields: candidates (concepts just extracted from a newsletter) and existingConcepts (concepts already known from previous newsletters with conceptId and label)",
    "For each candidate, decide whether it is the same underlying idea as one of the existingConcepts even if worded differently",
    "Use evidence only to understand what the candidate is about. It is a citation, not a definition.",
    "If it matches an existing concept, reuse that exact conceptId. Do not invent one.",
    "If it does not match anything in existingConcepts, create a new conceptId: short, lowercase, hyphenated slug; example: leader-election",
    "Keep new conceptIds generic so the same id could apply across different newsletters covering the same idea. Only qualify a conceptId with a specific system or product when the concept genuinely only makes sense in that context; example: raft-log-compaction rather than log-compaction when the idea is specific to Raft", 
    "Every candidate must end upwith exactly one action - reuse or create. Every candidate must end upwith exactly one conceptId",
  ].join("\n"),
  outputSchema: conceptResolutionOutputSchema,
  tools: [],
})



export async function persistNewConcepts(resolvedConcepts: ResolvedConcept[]): Promise<void> {

  const newConcepts = resolvedConcepts
    .filter( concept => concept.action == "create")
    .map( concept => ( {conceptId: concept.conceptId, label: concept.label, ...NEW_CONCEPT_DEFAULTS} ) )
    

  await createConcepts(newConcepts)
}