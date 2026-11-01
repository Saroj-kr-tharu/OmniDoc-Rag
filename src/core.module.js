import { Anthropic } from "@anthropic-ai/sdk/client.js";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod.mjs";
import { OpenAIEmbeddings } from "@langchain/openai";
import { QdrantVectorStore } from "@langchain/qdrant";
import dotenv from "dotenv";

import z from "zod";
import { DocumentLoader } from "./document_loader.js";

export class OmniRAG {
  AnswerFormat = z.object({
    question: z.string().describe("The question that was answered"),
    answer: z
      .string()
      .describe(
        "Berifly, accurate answer based only on the documents. Use 'I don't know' if not found.",
      ),
    source: z
      .string()
      .describe("File or book name, for example ./document/np.pdf"),
    page: z
      .string()
      .describe(
        "Page number, timestamp or sheet row. Use 'N/A' if not available",
      ),
  });

  AnswersFormat = z.object({
    answers: z.array(this.AnswerFormat),
  });

  DecompositionFormat = z.object({
    questions: z
      .array(z.string().trim().min(1))
      .min(1, "At least one question is required")
      .max(6, "Maximum 6 sub-questions"),
  });

  EnhanceFormat = z.object({
    queries: z.array(z.string().trim().min(1)).min(1).max(6),
  });

  constructor() {
    dotenv.config();
  }

  async ClaudeAi(systemPrompt = "", userQuestion = "", OutputFormat = null) {
    const claudeClient = new Anthropic({
      apiKey: process.env["ANTHROPIC_API_KEY"],
    });

    const message = await claudeClient.messages.create({
      max_tokens: 2024,
      system: systemPrompt,
      messages: [{ role: "user", content: userQuestion }],
      model: "claude-haiku-5-5",
      ...(OutputFormat && {
        output_config: { format: zodOutputFormat(OutputFormat) },
      }),
    });

    const raw = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    return raw;
  }

  EmbeddingsIntialize() {
    const embedding = new OpenAIEmbeddings({
      model: "text-embedding-3-small",
      apiKey: process.env.OPENAI_API_KEY,
    });
    return embedding;
  }

  async QdrantDBInialize(embedding) {
    const vectorStore = await QdrantVectorStore.fromExistingCollection(
      embedding,
      {
        url: process.env.QDRANT_URL,
        collectionName: "OmniDoc-collection",
      },
    );
    return vectorStore;
  }

  

  async Indexing(FilePath = "") {
    // 1. parse the document
      const docLoad = new DocumentLoader();
      const document = await docLoad.MainDocumentLoad(FilePath)


    // 2. get the semantic meangin using the llm
    const embedding = this.EmbeddingsIntialize();

    // get the vector embemding
    // 3. vector store
    const vectorStore = await this.QdrantDBInialize(embedding);

    await vectorStore.addDocuments(document);
    console.log("embedding vector store in QDrant db done");
  }

  async Query(UserQuestion = "") {
    // 1. UserQuestion to semantic meaning means embending
    const embbedings = this.EmbeddingsIntialize();

    // 2. search the vector embbeding  in vector db
    // 2.1 vector db
    const vectorStore = await this.QdrantDBInialize(embbedings);

    // 3. retrival
    const retrival = vectorStore.asRetriever({ k: 10 });
    // 3.1 get the enchance user query
    const DecompositionUserQuery = await this.DecompositionQuery(UserQuestion);
    const enchanceUserQuery = await this.EnhanceUserQuery(
      DecompositionUserQuery,
    );

    console.log(`\n OriginalUserQuery =>  ${UserQuestion} \n`);
    console.log(
      `DecompositionUserQuery =>  ${JSON.stringify(DecompositionUserQuery)} \n `,
    );
    console.log(
      `enchanceUserQuery =>  ${JSON.stringify(enchanceUserQuery)} \n `,
    );

    const settled = await Promise.allSettled(
      enchanceUserQuery.map((q) => retrival.invoke(q)),
    );

    const results = settled.map((r, i) => ({
      query: enchanceUserQuery[i],
      docs: r.status === "fulfilled" ? r.value : [],
      error: r.status === "rejected" ? r.reason?.message : null,
    }));

    const seen = new Set();
    const chunks = results
      .flatMap((r) => r.docs)
      .filter((doc) => {
        const key = `${doc.metadata?.source}-${doc.metadata?.loc?.pageNumber}-${doc.pageContent.slice(0, 80)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    const SYSTEM_PROMPT = `
                You are an expert in answering the user query based on the provied 
                context about the document. 
                Do not answer anything beyound the document. 
                If you don't know the answer just say the context is not provided or i don't know. 

                Always the answer in short sweet and accurate with the pageNumber 
                where does the content is available and sources or book Name.
                
               <documents>
                ${chunks
                  .map(
                    (e, i) => `<document index="${i + 1}">
                <source>${e.metadata?.source ?? "unknown"}</source>
                <page>${e.metadata?.loc?.pageNumber ?? "N/A"}</page>
                <content>${e.pageContent}</content>
                </document>`,
                  )
                  .join("\n")}
                </documents>
            `;

    // 4. chunks data and system prompt
    const resonse = await this.ClaudeAi(
      SYSTEM_PROMPT,
      UserQuestion,
      this.AnswersFormat,
    );
    // 5. llm call
    // 6. output
    // this.printAnswers(resonse);
    return JSON.parse(resonse);
  }

  async EnhanceUserQuery(subQuestions = []) {
    // accept a single string too
    if (typeof subQuestions === "string") subQuestions = [subQuestions];
    if (subQuestions.length === 0) return [];

    const enhanceUserQueryPrompt = `
            You are a Step-Back Query Enhancement Assistant for a document-based RAG system.

            You receive a JSON array of search questions. Your task is to enhance each question
            using step-back prompting to improve document retrieval accuracy.

            Instructions:
            - Enhance each question independently. Never merge questions together.
            - Understand the original intent of each question.
            - Keep all technical terms, API names, function names and acronyms exactly as written
            (for example "WSAAsyncSelect()", "MIDI"). Never remove or replace them.
            - Add the broader concept or underlying principle related to the question, so background
            information can also be retrieved.
            - Do not answer the questions.
            - Do not invent unsupported details.
            - Each enhanced query must be one sentence.
            - Return ONLY a JSON array of strings, with exactly the same length and the same order
            as the input. No explanations, labels or markdown.

            Example:
            Input: ["what is WSAAsyncSelect() API", "what are MIDI devices"]
            Output: ["What is the WSAAsyncSelect() API and how does Winsock asynchronous message-based socket event notification work?", "What are MIDI devices and how do MIDI hardware instruments communicate using channels and the MIDI standard?"]
            `;
    const response = await this.ClaudeAi(
      enhanceUserQueryPrompt,
      JSON.stringify(subQuestions),
      this.EnhanceFormat,
    );
    const parsed = JSON.parse(response);

    return parsed.queries;
  }

  async DecompositionQuery(UserQuery = "") {
    // 1. get the user query
    // 2. call llm
    // 3. get the user question []
    const decompositionQueryPrompt = `
            You are split a user's message into dependent, self-contained search questions.
            
            Rules: 
            - Return ONLY a JSON array of strings. No explanation, no markdown. 
            - One topic = one item. Do not split a single question into artificial parts. 
            - If the question has only one topic, return an array with the exactly one item. 
            - Make each item understandable on its own (replace words like 'it' or 'that' with the real subject ).
            - Maximum 5 items. 


            Examples:
            Input: "what is MIDI devices"
            Output: ["what is MIDI devices"]

            Input: "explain WSAAsyncSelect and what are MIDI devices"
            Output: ["what is WSAAsyncSelect() API", "what are MIDI devices"]

            Input: "what is TCP, how is it different from UDP, and what is a socket?"
            Output: ["what is TCP", "what is the difference between TCP and UDP", "what is a socket"]

        `;
    const response = await this.ClaudeAi(
      decompositionQueryPrompt,
      UserQuery,
      this.DecompositionFormat,
    );
    const parsed = JSON.parse(response.replace(/```json|```/g, "").trim());
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [UserQuery];
  }
}

// const rag = new OmniRAG();
// rag.Indexing('./document/Mobile.pdf')
// rag.Query(
//   "say about  WINDOWS OPERATING MODES ,  Synthesis Methods , CDMA system ,Prompt Templates",
// );
