import "dotenv/config"
import express from "express"
import { ingestNewsletter } from "./ingest"
import { getQuiz } from "./db/models/quiz"
import { getQuestions } from "./db/models/question"
import { renderHomePage, renderQuizPage } from "./render"
import { parseAnswers } from "./db/models/answer"
import { applyAnswers, createAttempt } from "./db/models/Attempt"
import { getNewsletter } from "./db/models/newsletter"
import { ingestViaAgent } from "./agent-client"

const app = express()
app.use((req, _res, next) => {
  console.log("REQ", req.method, req.originalUrl)
  next()
})

app.use(express.json({limit: "1mb"}))
app.use(express.text({type: "text/*", limit: "1mb"}))
app.use(express.urlencoded({extended: false, limit: "1mb"}))

app.get("/healthz", (_req, res) => {
  res.json({ok: true})
})

app.post("/api/newsletter", async(req, res) => {
  let content : string
  if (typeof req.body == "string") {
    // from text file upload
    content = (req.body).trim()
  } else {
    // find json parameter
    content = (req.body?.newsletterContent ?? "").trim()
  }
  
  if(!content) {
    return res.status(400).json({"error": "newsletterContent required"})
  }

  try {
    const result = await ingestViaAgent(content)
    res.json(result)
  } catch (err) {
    console.error("ingest failed", err)
    res.status(500).json({error: String(err)})
  }

})

app.get("/quiz/:id", async(req, res) => {
  try {
    const quiz = await getQuiz(req.params.id)

    if(!quiz) {
      return res.status(404).type("html").send("Quiz not found")
    }

    const questions = await getQuestions(quiz.questionIds)

    if(questions.length != quiz.questionIds.length) {
      console.warn(
        `
          quiz - ${quiz.id},
          expected questions count - ${quiz.questionIds.length},
          loaded questions count - ${questions.length}
        `
      )
    }

    const newsletter = await getNewsletter(quiz.newsletterId)
    if(!newsletter) {
      return res.status(404).type("html").send("Newsletter not found")
    }
    
    res.type("html").send(renderQuizPage(newsletter, quiz, questions))
  } catch(err) {
    console.error("render quiz failed - ", err)
    res.status(500).type("html").send("Something went wrong!")
  }
})

app.post("/quiz/:id/submit", async (req, res) => {
  try {
    const quiz = await getQuiz(req.params.id)
    if(!quiz) {
      return res.status(404).type("html").send("Quiz not found")
    }

    const questions = await getQuestions(quiz.questionIds)
    const answers = parseAnswers(questions, req.body ?? {})

    console.log(`
      quiz - ${quiz.id},
      answers - ${JSON.stringify(answers)}
    `)

    const attempt = await createAttempt({
      quizId: quiz.id,
      userId: quiz.userId,
      answers,
    })
    console.log("attempt created = ", attempt.id)

    await applyAnswers(answers)
    console.log("concept confidence updated")
    
    res.type("html").send("<h1>Answers received!</h1>")
  } catch(err) {
    console.error("submit answers failed - ", err)
    res.status(500).type("html").send("Somthing went wrong!")
  }
})

app.get("/", async(req, res) => {
  res.type("html").send(renderHomePage())
})

app.post("/newsletter", async(req, res) => {
  const content = (req.body?.newsletterContent ?? "").trim()
  if(!content){
    return res.redirect(303, "/")
  }

  console.log("ingest starting, chars = ", content.length)
  const {quizId} = await ingestViaAgent(content)
  console.log("ingest done. quizId = ", quizId)

  res.redirect(303, `/quiz/${quizId}`)
})

app.use((req, res) => {
  res.status(404).json({ error: "no route", method: req.method, path: req.originalUrl })
})

const PORT = Number(process.env.PORT) || 8080
app.listen(PORT, () => {console.log("listening on port 8080!")})