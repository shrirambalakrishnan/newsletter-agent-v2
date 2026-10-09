import "dotenv/config"
import { LlmAgent } from "@google/adk";
import { model } from "./model"
import z, { string } from "zod";
import { newQuestionId, Question } from "./db/models/question";

export const generatedQuestionSchema = z.object({
  conceptId: z
    .string()
    .describe("id of concept this question tests"),
  questionText: z
    .string()
    .describe("question text"),
  options: z
    .array(string())
    .describe("Exactly 4 answer options"),
  correctIndex: z
    .number()
    .describe("zsero-based index of correct option"),
  difficulty: z
    .enum(["easy", "medium"])
    .describe("states the difficulty of the question")
})

export const questionGenerationOutputSchema = z.object({
  questions: z.array(generatedQuestionSchema)
})

export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>

export const questionGenerationAgent = new LlmAgent({
  name: "question_generation_agent",
  model,
  description: "Write one multiple choice question for each of the concept taugh in newsletter",
  instruction: [
    "You will receive a JSON object with two fields: newsletterContent and concepts. newsletterContent is the content of newsletter the user has just read. concepts are the the concepts that newsletter teaches. Each concept has conceptId, lable, and an evidence passage taken from newsletter",
    "Write exactly one multiple choice question for each of the concept in the same order you received them",
    "The newsletter is your source material. Draw on all of it - the concept explanation, the examples, the comparisons, the consequences and how concepts relate to each other - not only the evidence passage",
    "The evidence passage of each concept tells you where in the newsletter a concept was introduced. The concept tagged to a question decides what that question must test. Do not let a question drift onto a different concept",
    "The question should test whether the reader understood the idea, not whether they memorised wording.",
    "Give exactly four options. Exactly one must be correct. correctIndex is the zero-based position of that correct option",
    "Wrong options must be plausible to someone who skimmed the newsletter without understanding the concepts. Never use joke options, throwaway options, or options obviously wrong on sight",
    "Keep all four options similar in length so that correct option does not stand out",
    "Never choose to have 'all of the above', 'none of the above' or options that overlap so that more than one could be argued to be correct. Avoid trivia, negations.",
    "The question must read as standalone question about the concept. DO not refer to the newsletter from the question",
    "Mark difficulty easy when a single sentence of evidence answers the question, and meduim when the reader has to understand the concept to choose correctly",
    "Questions should be of medium or easy difficulty. DO not create hard questions requiring multi-step reasoningn chains",
    "Set conceptId on each question to the exact conceptId given for that concept. Never invent, reword or reformat a conceptId"
  ].join("\n"),
  outputSchema: questionGenerationOutputSchema,
  tools: []
})

export function toQuestions(
  generatedQuestions: GeneratedQuestion[],
  conceptIds: string[]
): Question[] {

  const allowedConceptIds = new Set(conceptIds)

  return generatedQuestions
  .filter( candidate => {

    if ( !allowedConceptIds.has(candidate.conceptId) ) {
      console.warn("invalid conceptId. dropping question")
      return false
    }
    
    if (
      !Number.isInteger(candidate.correctIndex) ||
      candidate.correctIndex < 0 ||
      candidate.correctIndex > candidate.options.length 
    ) {
      console.warn("invalid correct option ID. dropping question")
      return false
    }

    return true
  })
  .map( candidate => ({

    id: newQuestionId(candidate.conceptId),
    conceptId: candidate.conceptId,
    questionText: candidate.questionText,
    options: candidate.options,
    correctIndex: candidate.correctIndex,
    difficulty: candidate.difficulty,
    
  }))
  
}