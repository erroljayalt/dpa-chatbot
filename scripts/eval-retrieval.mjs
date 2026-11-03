// Checks that each question retrieves the Section it should, and that off-topic questions
// are refused without calling the AI. Start the app first (npm run dev), then: npm run eval
// Or check the live site: node scripts/eval-retrieval.mjs https://dpa-chatbot.vercel.app

const BASE = process.argv[2] ?? "http://localhost:3000";

// [question, chunk id that must be in the top 5 (a Section's parts count too), or "OFF"]
const CASES = [
  ["What does sensitive personal information mean?", "sec-3l"],
  ["What is sensitive personal information?", "sec-3l"],
  ["What does processing mean?", "sec-3j"],
  ["What does DPA mean?", "overview"],
  ["When was it established?", "overview"],
  ["What is the purpose of the DPA?", "sec-2"],
  ["What does Section 16 say?", "sec-16"],
  ["Ano ang mga karapatan ko?", "sec-16"],
  ["What is the capital of France?", "OFF"],
  ["Who won the 2022 World Cup?", "OFF"],
  ["How do I bake bread?", "OFF"],
  ["What is the weather today?", "OFF"],
];

let failed = 0;
for (const [q, want] of CASES) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: q }] }),
  });
  if (!res.ok) {
    console.log(`FAIL  ${q}\n      HTTP ${res.status} ${await res.text()}`);
    failed++;
    continue;
  }
  const events = (await res.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const ids = events.find((e) => e.type === "sources")?.sources.map((s) => s.id) ?? [];
  const provider = events.find((e) => e.type === "done")?.provider;
  const pass =
    want === "OFF"
      ? ids.length === 0 && provider === "none"
      : ids.some((id) => id === want || id.startsWith(`${want}-`));
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${q}\n      ${want === "OFF" ? `provider: ${provider}` : `got: ${ids.join(", ")}`}`);
}

console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
process.exit(failed ? 1 : 0);
