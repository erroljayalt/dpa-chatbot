// Free LLM providers with automatic fallback:
//   Gemini (each model has its own free quota) → Groq (optional backup).
// A provider is skipped only if it fails before sending any text.

import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import Groq from "groq-sdk";
import type { ChatMessage } from "./types";

const GEMINI_MODELS = (process.env.GEMINI_MODELS ?? "gemini-3.5-flash-lite,gemini-3.8-flash")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const GROQ_MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";
const FIRST_TOKEN_MS = 12_000;

type Provider = { name: string; stream: (system: string, messages: ChatMessage[]) => AsyncGenerator<string> };

function providers(): Provider[] {
  const list: Provider[] = [];

  if (process.env.GEMINI_API_KEY) {
    // No silent retries: if a model is busy we move on to the next one right away.
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: { timeout: 45_000, retryOptions: { attempts: 1 } },
    });
    for (const model of GEMINI_MODELS) {
      list.push({
        name: `gemini:${model}`,
        async *stream(system, messages) {
          const contents = messages.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          }));
          const base = { systemInstruction: system, temperature: 0.2, maxOutputTokens: 1536 };
          let res;
          try {
            res = await ai.models.generateContentStream({
              model,
              contents,
              config: { ...base, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
            });
          } catch (e) {
            // Some models don't accept a thinking level — retry once with defaults.
            if (!/thinking/i.test(String((e as Error).message))) throw e;
            res = await ai.models.generateContentStream({ model, contents, config: base });
          }
          for await (const chunk of res) if (chunk.text) yield chunk.text;
        },
      });
    }
  }

  if (process.env.GROQ_API_KEY) {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0, timeout: 45_000 });
    list.push({
      name: `groq:${GROQ_MODEL}`,
      async *stream(system, messages) {
        const res = await groq.chat.completions.create({
          model: GROQ_MODEL,
          temperature: 0.2,
          max_tokens: 1024,
          stream: true,
          messages: [{ role: "system", content: system }, ...messages],
        });
        for await (const chunk of res) {
          const t = chunk.choices[0]?.delta?.content;
          if (t) yield t;
        }
      },
    });
  }

  return list;
}

/** Streams an answer, trying each free provider in turn. Yields {provider} first, then text. */
export async function* streamAnswer(
  system: string,
  messages: ChatMessage[]
): AsyncGenerator<{ provider: string } | { text: string }> {
  const list = providers();
  if (!list.length) throw new Error("No AI provider configured. Add GEMINI_API_KEY (and optionally GROQ_API_KEY).");

  let lastError: unknown;
  for (const p of list) {
    let started = false;
    try {
      const it = p.stream(system, messages);
      const firstP = it.next();
      firstP.catch(() => {}); // if we time out, a late failure must not crash the server
      // A provider that hasn't started answering within FIRST_TOKEN_MS is skipped.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const first = await Promise.race([
        firstP,
        new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error(`${p.name} too slow to respond`)), FIRST_TOKEN_MS))),
      ]).finally(() => clearTimeout(timer));
      if (!first.done) {
        started = true;
        yield { provider: p.name };
        yield { text: first.value };
        for await (const text of { [Symbol.asyncIterator]: () => it }) yield { text };
        return;
      }
      lastError = new Error(`${p.name} returned an empty answer`);
    } catch (e) {
      if (started) throw e; // can't switch providers mid-answer
      lastError = e;
      console.warn(`${p.name} failed, trying next provider:`, (e as Error).message);
    }
  }
  throw lastError;
}
