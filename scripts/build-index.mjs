// Builds data/index.json from data/RA10173.txt.
//
//   1. Splits the law into Sections (long Sections are split into parts).
//   2. Adds an "overview" chunk with the title, dates and signatories.
//   3. Embeds every chunk with Gemini (free tier) for meaning-based search.
//
// Run with: npm run build-index   (needs GEMINI_API_KEY in .env.local)
// Without a key it still writes the index, but search falls back to keywords only.

import { readFileSync, writeFileSync } from "node:fs";
import { GoogleGenAI } from "@google/genai";

const SRC = new URL("../data/RA10173.txt", import.meta.url);
const OUT = new URL("../data/index.json", import.meta.url);
const EMBED_MODEL = "gemini-embedding-001";
const DIMS = 768;
const MAX_PART = 1400; // characters per chunk before a Section is split

const text = readFileSync(SRC, "utf8").replace(/\r\n/g, "\n");
const lines = text.split("\n");

// ---------- 1. Parse chapters and sections ----------
const sections = [];
let chapter = "";
let current = null;
let pendingChapter = null;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  const ch = line.match(/^CHAPTER ([IVX]+)$/);
  if (ch) {
    // Chapter title can span two lines (e.g. Chapter VII)
    let title = lines[i + 1].trim();
    if (lines[i + 2]?.trim() && !/^Section \d+\./.test(lines[i + 2].trim())) title += " " + lines[i + 2].trim();
    pendingChapter = `Chapter ${ch[1]} - ${titleCase(title)}`;
    continue;
  }
  const sec = line.match(/^Section (\d+)\. ([^.]+(?:\([^)]*\))?[^.]*)\. - (.*)$/);
  if (sec) {
    if (pendingChapter) { chapter = pendingChapter; pendingChapter = null; }
    current = { section: Number(sec[1]), title: sec[2].trim(), chapter, paragraphs: [sec[3].trim()] };
    sections.push(current);
    continue;
  }
  if (/^Approved,$/.test(line)) current = null; // signatures start
  if (current && line && !pendingChapter && !/^[A-Z ]+$/.test(line)) current.paragraphs.push(line);
}

if (sections.length !== 45) throw new Error(`Expected 45 sections, found ${sections.length}`);

function titleCase(s) {
  const t = s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Of|The|For|In|And)\b/g, (m) => m.toLowerCase());
  return t[0].toUpperCase() + t.slice(1);
}

// ---------- 2. Build chunks ----------
const chunks = [];

chunks.push({
  id: "overview",
  section: null,
  label: "Title & Approval",
  title: "Title, enactment and approval of the Data Privacy Act of 2012",
  chapter: "",
  text: [
    'Republic Act No. 10173 is known as the "Data Privacy Act of 2012" (commonly abbreviated DPA).',
    // Sentence case on purpose: Gemini cuts off answers that copy the ALL-CAPS title verbatim.
    "Its long title describes it as an Act protecting individual personal information in information and communications systems in the government and the private sector, and creating a National Privacy Commission for this purpose.",
    "Enacted by the Fifteenth Congress, Second Regular Session, begun and held in Metro Manila on Monday, the twenty-fifth day of July, two thousand eleven.",
    "This Act is a consolidation of Senate Bill No. 2965 and House Bill No. 4115. It was finally passed by the Senate and the House of Representatives on June 6, 2012.",
    "Approved (signed into law) on August 15, 2012 by BENIGNO S. AQUINO III, President of the Philippines.",
    "Signed by JUAN PONCE ENRILE, President of the Senate; FELICIANO BELMONTE JR., Speaker of the House of Representatives; EMMA LIRIO-REYES, Secretary of the Senate; and MARILYN B. BARUA-YAP, Secretary General of the House of Representatives.",
    "Under Section 45 (Effectivity Clause), the Act takes effect fifteen (15) days after its publication in at least two (2) national newspapers of general circulation.",
    "The Act has 45 Sections in 9 Chapters: " + [...new Set(sections.map((s) => s.chapter))].join("; ") + ".",
  ].join("\n\n"),
});

for (const s of sections) {
  const header = `Section ${s.section}. ${s.title}`;

  // Section 3 holds 12 definitions: one chunk per defined term so "What is X?" finds it exactly.
  if (s.section === 3) {
    const [intro, ...rest] = s.paragraphs;
    const defs = [];
    for (const p of rest) {
      if (/^\([a-z]\) /.test(p)) defs.push([p]);
      else defs.at(-1).push(p); // numbered sub-items belong to the previous definition
    }
    for (const d of defs) {
      const letter = d[0].slice(1, 2);
      const term = d[0].match(/^\([a-z]\) (.+?) (?:shall refer|refers) to/)[1];
      chunks.push({
        id: `sec-3${letter}`,
        section: 3,
        label: "Sec. 3",
        title: `Definition of Terms: ${term} (${letter})`,
        chapter: s.chapter,
        text: `${header} - definition of "${term}"\n${s.chapter}\n\n${intro}\n\n${d.join("\n\n")}`,
      });
    }
    continue;
  }

  const full = s.paragraphs.join("\n\n");
  const parts = [];
  if (full.length <= MAX_PART) parts.push(full);
  else {
    // Keep the Section's opening sentence on every part so each part stands alone.
    const [intro, ...rest] = s.paragraphs;
    let buf = [intro];
    for (const p of rest) {
      if (buf.join("\n\n").length + p.length > MAX_PART && buf.length > 1) {
        parts.push(buf.join("\n\n"));
        buf = [intro.length > 300 ? intro.slice(0, 300) + "…" : intro, p];
      } else buf.push(p);
    }
    parts.push(buf.join("\n\n"));
  }
  parts.forEach((body, i) => {
    chunks.push({
      id: parts.length > 1 ? `sec-${s.section}-${i + 1}` : `sec-${s.section}`,
      section: s.section,
      label: `Sec. ${s.section}`,
      title: s.title + (parts.length > 1 ? ` (part ${i + 1} of ${parts.length})` : ""),
      chapter: s.chapter,
      text: `${header}${parts.length > 1 ? ` (part ${i + 1} of ${parts.length})` : ""}\n${s.chapter}\n\n${body}`,
    });
  });
}

// ---------- 3. Embed ----------
const key = process.env.GEMINI_API_KEY;
let embedded = false;
if (!key) {
  console.warn("⚠ GEMINI_API_KEY not set — writing keyword-only index (no embeddings).");
} else {
  const ai = new GoogleGenAI({ apiKey: key });
  const norm = (v) => { const n = Math.hypot(...v); return v.map((x) => Math.round((x / n) * 1e5) / 1e5); };
  for (let i = 0; i < chunks.length; i += 20) {
    const batch = chunks.slice(i, i + 20);
    const res = await ai.models.embedContent({
      model: EMBED_MODEL,
      contents: batch.map((c) => c.text),
      config: { taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: DIMS },
    });
    res.embeddings.forEach((e, j) => { batch[j].embedding = norm(e.values); });
    process.stdout.write(`embedded ${Math.min(i + 20, chunks.length)}/${chunks.length}\r`);
  }
  embedded = true;
  console.log();
}

writeFileSync(OUT, JSON.stringify({
  source: "Republic Act No. 10173 (Data Privacy Act of 2012), text from lawphil.net",
  embedModel: embedded ? EMBED_MODEL : null,
  dims: embedded ? DIMS : 0,
  builtAt: new Date().toISOString(),
  chunks,
}));
console.log(`✔ Wrote ${chunks.length} chunks from ${sections.length} sections to data/index.json (embeddings: ${embedded ? "yes" : "no"})`);
