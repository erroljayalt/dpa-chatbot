// Sends sample questions to the running chatbot and prints the answers.
// Start the app first (npm run dev), then: npm run test-rag
// Or test the live site: node scripts/test-questions.mjs https://your-app.vercel.app

const BASE = process.argv[2] ?? "http://localhost:3000";

const QUESTIONS = process.argv[3] ? [process.argv[3]] : [
  "What does DPA mean?",
  "When was it established?",
  "What is personal information?",
  "What are the rights of a data subject?",
  "What is the penalty for unauthorized processing of sensitive personal information?",
  "Ano ang National Privacy Commission?",
  "What is the capital of France?", // should be refused
];

for (const q of QUESTIONS) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: q }] }),
  });
  console.log(`\n━━━ Q: ${q}`);
  if (!res.ok) {
    console.log("HTTP", res.status, await res.text());
    continue;
  }
  let answer = "", sources = [], provider = "";
  for (const line of (await res.text()).split("\n").filter(Boolean)) {
    const ev = JSON.parse(line);
    if (ev.type === "sources") sources = ev.sources.map((s) => s.label);
    if (ev.type === "text") answer += ev.value;
    if (ev.type === "reset") { answer = ""; console.log("(answer was cut off — retried in paraphrase mode)"); }
    if (ev.type === "done") provider = ev.provider;
    if (ev.type === "error") answer += `[ERROR] ${ev.message}`;
  }
  console.log(`retrieved: ${[...new Set(sources)].join(", ")}  |  model: ${provider}  |  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(answer.trim());
}
