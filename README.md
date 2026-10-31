# Ask the Data Privacy Act

A RAG chatbot that answers questions about the **Philippine Data Privacy Act of 2012 (Republic Act No. 10173)** using only the text of the law, and cites the Section behind every answer.

- **Free to run:** Google Gemini free tier, with optional Groq free tier as a backup, hosted on Vercel Hobby.
- **Three.js** animated background with a chat panel.
- **Clickable citations:** tap `Sec. 16` to read that Section's text.

## How it works

```
Build time:  data/RA10173.txt → split into Sections (73 chunks) → Gemini embeddings → data/index.json
Each question:
  browser → /api/chat → hybrid search (BM25 keywords + embeddings) finds the top 5 chunks
          → Gemini answers ONLY from those chunks → streamed back with [Sec. N] citations
```

| File | What it does |
|---|---|
| `data/RA10173.txt` | The law's full text (from lawphil.net, scanning typos fixed) |
| `data/index.json` | Pre-built search index with embeddings (committed, so Vercel doesn't rebuild it) |
| `scripts/build-index.mjs` | Rebuilds `index.json`. Run it if you edit the law text. |
| `lib/retrieve.ts` | Hybrid search |
| `lib/llm.ts` | Free AI providers with automatic fallback |
| `lib/prompt.ts` | Rules the bot follows (answer only from the law, cite Sections) |
| `app/api/chat/route.ts` | Chat API with rate limit (20 questions per 10 min per visitor) |
| `components/DataCore.tsx` | Three.js scene |
| `components/Chat.tsx` | Chat UI |

### AI fallback order
1. `gemini-3.5-flash-lite`: fast, and has its own free quota
2. `gemini-3.8-flash`: smarter, but often busy on the free tier
3. `llama-3.3-70b-versatile` on Groq, only if `GROQ_API_KEY` is set

If a model fails or hasn't started answering within 12 seconds, the next one is tried. To change the order, set `GEMINI_MODELS`.

## Run locally

1. Install [Node.js](https://nodejs.org) 20 or later.
2. Copy `.env.example` to `.env.local` and add your free key from https://aistudio.google.com/apikey.
3. Install and start the app:
   ```bash
   npm install
   npm run dev
   ```
4. Open http://localhost:3000.
5. Optional: with the app running, run `npm run test-rag` to ask the sample questions.

## Deploy to Vercel (GitHub)

1. Push this folder to a GitHub repository. `.env.local` is git-ignored, so your keys stay private.
2. Go to https://vercel.com/new and **Import** the repository. Vercel detects Next.js automatically.
3. Before clicking **Deploy**, open **Environment Variables** and add:
   - `GEMINI_API_KEY`: your Gemini key
   - `GROQ_API_KEY`: optional, from https://console.groq.com/keys
4. Click **Deploy**. Your site is live at `https://<project-name>.vercel.app`.
5. Every `git push` to the main branch redeploys automatically.

To test the live site:
```bash
node scripts/test-questions.mjs https://<project-name>.vercel.app
```

## Notes and limits
- **Free tiers have usage limits.** When every provider is busy or out of quota, the bot says "The free AI service is busy right now."
- **Free-tier data use:** Google may use content sent to the free tier to improve its products. That's fine for public law text, but users shouldn't enter personal data. The page shows a notice saying so.
- **Vercel Hobby is for non-commercial use.** For official company use, upgrade to Vercel Pro.
- **Rate limit:** stored in memory per server instance. It's a light guard, not a hard cap.
- **Scope:** the bot knows only RA 10173 as enacted in 2012. It doesn't cover the IRR, NPC circulars, or amendments. It provides information, not legal advice.
