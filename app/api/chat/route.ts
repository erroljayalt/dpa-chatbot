import { retrieve } from "@/lib/retrieve";
import { streamAnswer } from "@/lib/llm";
import { systemPrompt } from "@/lib/prompt";
import { checkRateLimit } from "@/lib/rateLimit";
import type { ChatMessage, Source, StreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_QUESTION = 500;
const MAX_HISTORY = 6;

function json(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const limit = checkRateLimit(ip);
  if (!limit.ok) return json(429, `You've asked a lot of questions. Please wait ${Math.ceil(limit.retryAfterSec / 60)} minute(s) and try again.`);

  let body: { messages?: ChatMessage[] };
  try {
    body = await req.json();
  } catch {
    return json(400, "Invalid request.");
  }

  const messages = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  const last = messages.at(-1);
  if (!last || last.role !== "user" || !last.content.trim()) return json(400, "Please type a question.");
  if (last.content.length > MAX_QUESTION) return json(400, `Please keep your question under ${MAX_QUESTION} characters.`);
  if (messages[0].role !== "user") messages.shift();

  // Short follow-ups ("what's the penalty for it?") borrow context from the previous question.
  const prevUser = messages.slice(0, -1).reverse().find((m) => m.role === "user");
  const searchQuery = last.content.split(/\s+/).length < 8 && prevUser ? `${prevUser.content} ${last.content}` : last.content;

  const { chunks } = await retrieve(searchQuery);
  const sources: Source[] = chunks.map(({ embedding: _e, ...s }) => s);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      send({ type: "sources", sources });
      let provider = "";
      try {
        for await (const part of streamAnswer(systemPrompt(chunks), messages)) {
          if ("provider" in part) provider = part.provider;
          else if ("reset" in part) send({ type: "reset" });
          else send({ type: "text", value: part.text });
        }
        send({ type: "done", provider });
      } catch (e) {
        console.error("Answer failed:", e);
        const msg = String((e as Error)?.message ?? e);
        send({
          type: "error",
          message: /429|quota|rate|exhaust/i.test(msg)
            ? "The free AI service is busy right now. Please try again in a minute."
            : /No AI provider/.test(msg)
              ? "The chatbot isn't set up yet: the server is missing its API key."
              : "Something went wrong while answering. Please try again.",
        });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
