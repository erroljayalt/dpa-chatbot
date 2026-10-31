// Hybrid retrieval: BM25 keywords + Gemini embeddings, merged with Reciprocal Rank Fusion.

import { GoogleGenAI } from "@google/genai";
import index from "@/data/index.json";
import { BM25 } from "./bm25";
import type { Chunk } from "./types";

const chunks = index.chunks as Chunk[];
const bm25 = new BM25(chunks.map((c) => `${c.title} ${c.title} ${c.text}`)); // title counted twice

// Abbreviations people use that the law spells out.
const ALIASES: Record<string, string> = {
  dpa: "data privacy act",
  npc: "national privacy commission commission",
  pic: "personal information controller",
  pip: "personal information processor",
  spi: "sensitive personal information",
  irr: "implementing rules and regulations",
  dict: "department of information and communications technology",
  pi: "personal information",
};

function expand(q: string): string {
  return q.replace(/\b[a-z]{2,4}\b/gi, (w) => {
    const a = ALIASES[w.toLowerCase()];
    return a ? `${w} ${a}` : w;
  });
}

let ai: GoogleGenAI | null = null;
async function embedQuery(q: string): Promise<number[] | null> {
  if (!index.embedModel || !process.env.GEMINI_API_KEY) return null;
  ai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const res = await Promise.race([
      ai.models.embedContent({
        model: index.embedModel,
        contents: q,
        config: { taskType: "RETRIEVAL_QUERY", outputDimensionality: index.dims },
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("embed timeout")), 5000)),
    ]);
    const v = res.embeddings?.[0]?.values;
    if (!v) return null;
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  } catch (e) {
    console.warn("Query embedding failed, using keyword search only:", (e as Error).message);
    return null;
  }
}

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

export async function retrieve(query: string, k = 5): Promise<{ chunks: Chunk[]; mode: "hybrid" | "keyword" }> {
  const q = expand(query);
  const scores = new Map<number, number>();
  const RRF = 60;

  bm25.search(q).slice(0, 20).forEach(([i], rank) => {
    scores.set(i, (scores.get(i) ?? 0) + 1 / (RRF + rank));
  });

  const qv = await embedQuery(q);
  if (qv) {
    chunks
      .map((c, i) => [i, c.embedding ? dot(qv, c.embedding) : -1] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .forEach(([i], rank) => scores.set(i, (scores.get(i) ?? 0) + 1 / (RRF + rank)));
  }

  // Boosts for questions the text answers in a known place.
  const boost = (pred: (c: Chunk) => boolean, amount = 0.05) =>
    chunks.forEach((c, i) => pred(c) && scores.set(i, (scores.get(i) ?? 0) + amount));

  const secRef = [...query.matchAll(/\b(?:section|sec\.?)\s*(\d{1,2})\b/gi)].map((m) => Number(m[1]));
  if (secRef.length) boost((c) => c.section !== null && secRef.includes(c.section), 1);
  if (/\b(when|date|year|establish|enact|approv|sign|pass|effectiv|history|creat|title|stand for|mean|called|known as|dpa)\w*/i.test(query))
    boost((c) => c.id === "overview" || c.section === 1 || c.section === 45);
  if (/\b(purpose|policy|objective|goal|aim|intent|why|what is the (dpa|data privacy act|law|act)|about)\b/i.test(query))
    boost((c) => c.section === 2 || c.id === "overview", 0.06);

  const top = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([i]) => chunks[i]);

  return { chunks: top, mode: qv ? "hybrid" : "keyword" };
}
