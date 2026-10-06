import "dotenv/config"
import {Firestore} from "@google-cloud/firestore"

const projectId = process.env.FIRESTORE_PROJECT_ID ?? "newsletter-agent-v2"
const firestoreDatabaseId = process.env.FIRESTORE_DATABASE_ID ?? "newsletter-agent-v2-db"

export const db = new Firestore({
  projectId,
  databaseId: firestoreDatabaseId
})
