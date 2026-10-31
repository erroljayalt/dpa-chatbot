"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ChatMessage, Source, StreamEvent } from "@/lib/types";

type Msg = ChatMessage & { sources?: Source[]; error?: boolean; pending?: boolean };

const WELCOME: Msg = {
  role: "assistant",
  content:
    "Hi! I'm the **DPA Assistant**. Ask me anything about the **Data Privacy Act of 2012 (RA 10173)**. I answer only from the text of the law and show the Section each answer comes from.",
};

export const SUGGESTIONS = [
  "What does DPA mean?",
  "When was it established?",
  "What is personal information?",
  "What are my rights as a data subject?",
  "What is sensitive personal information?",
  "What is the penalty for unauthorized processing?",
  "What is the National Privacy Commission?",
];

// Matches [Sec. 16], [Title & Approval], and combined tags like [Sec. 1, Sec. 45] or [Sec. 16; Sec. 18].
const LABEL = /Sec\. \d+|Title & Approval/g;
const CITE = /\[((?:Sec\. \d+|Title & Approval)(?:\s*[,;]\s*(?:Sec\. \d+|Title & Approval))*)\]/g;
const labelsIn = (text: string) => [...text.matchAll(CITE)].flatMap((m) => m[1].match(LABEL) ?? []);

export type QueuedQuestion = { text: string; id: number };

export default function Chat({ onBusy, queued }: { onBusy: (busy: boolean) => void; queued?: QueuedQuestion | null }) {
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<{ label: string; parts: Source[] } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => onBusy(busy), [busy, onBusy]);

  // Questions clicked in the "Try asking" list outside the chat panel.
  useEffect(() => {
    if (queued) ask(queued.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued?.id]);

  function update(fn: (m: Msg) => Msg) {
    setMessages((all) => [...all.slice(0, -1), fn(all[all.length - 1])]);
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);

    const history = [...messages.filter((m) => m !== WELCOME && !m.error && !m.pending), { role: "user" as const, content: q }];
    setMessages((all) => [...all, { role: "user", content: q }, { role: "assistant", content: "", pending: true }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })) }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Something went wrong. Please try again." }));
        throw new Error(err.error);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as StreamEvent;
          if (ev.type === "sources") update((m) => ({ ...m, sources: ev.sources }));
          else if (ev.type === "text") update((m) => ({ ...m, content: m.content + ev.value }));
          else if (ev.type === "reset") update((m) => ({ ...m, content: "" })); // shows the typing dots again
          else if (ev.type === "error") throw new Error(ev.message);
        }
      }
      update((m) => ({ ...m, pending: false }));
    } catch (e) {
      update((m) => ({ ...m, pending: false, error: true, content: (e as Error).message || "Something went wrong. Please try again." }));
    } finally {
      setBusy(false);
    }
  }

  function openSource(label: string, sources: Source[] = []) {
    const parts = sources.filter((s) => s.label === label);
    if (parts.length) setViewing({ label, parts });
  }

  return (
    <section className="chat" aria-label="Chat with the DPA Assistant">
      <div className="chat-head">
        <span className="dot" />
        <b>DPA Assistant</b>
        <button className="ghost" type="button" onClick={() => setMessages([WELCOME])} disabled={busy}>
          New chat
        </button>
      </div>

      <div className="log" ref={logRef} aria-live="polite">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="msg user">{m.content}</div>
          ) : (
            <div key={i} className={`msg bot${m.error ? " error" : ""}`}>
              {m.pending && !m.content ? (
                <span className="typing" aria-label="Searching the law"><i /><i /><i /></span>
              ) : m.error ? (
                <p>{m.content}</p>
              ) : (
                <BotText text={m.content} onCite={(label) => openSource(label, m.sources)} />
              )}
              {!m.pending && !m.error && <Cited text={m.content} sources={m.sources} onOpen={(l) => openSource(l, m.sources)} />}
            </div>
          )
        )}
      </div>

      <div className="chips">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" disabled={busy} onClick={() => ask(s)}>{s}</button>
        ))}
      </div>

      <form className="ask" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
        <input
          id="question"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={500}
          autoComplete="off"
          placeholder="Ask about the Data Privacy Act…"
          aria-label="Your question"
        />
        <button className="send" type="submit" disabled={busy || !input.trim()}>Ask</button>
      </form>
      <div className="note">Answers come only from RA 10173 · Not legal advice · Don&apos;t enter personal data</div>

      {viewing && (
        <div className="sheet" role="dialog" aria-label={`Text of ${viewing.label}`}>
          <div className="sheet-head">
            <div>
              <small>{viewing.label}{viewing.parts[0].chapter ? ` · ${viewing.parts[0].chapter}` : ""}</small>
              <b>{viewing.parts[0].title.replace(/ \(part \d+ of \d+\)$/, "")}</b>
            </div>
            <button className="ghost" type="button" onClick={() => setViewing(null)} autoFocus>Close</button>
          </div>
          <div className="sheet-body">
            {viewing.parts.map((p) => p.text.split("\n").slice(viewing.parts[0].section ? 2 : 0).join("\n").trim()).join("\n\n…\n\n")}
          </div>
        </div>
      )}
    </section>
  );
}

// Renders the answer's markdown, turning [Sec. 16] citations into clickable tags.
function BotText({ text, onCite }: { text: string; onCite: (label: string) => void }) {
  const md = text.replace(CITE, (_, group: string) =>
    (group.match(LABEL) ?? []).map((label) => `[${label}](#cite:${encodeURIComponent(label)})`).join(" ")
  );
  return (
    <ReactMarkdown
      components={{
        a: ({ href, children }) =>
          href?.startsWith("#cite:") ? (
            <button type="button" className="cite-inline" onClick={() => onCite(decodeURIComponent(href.slice(6)))}>{children}</button>
          ) : (
            <a href={href} target="_blank" rel="noreferrer">{children}</a>
          ),
      }}
    >
      {md}
    </ReactMarkdown>
  );
}

// Source tags under an answer: only the Sections the answer actually cited.
function Cited({ text, sources = [], onOpen }: { text: string; sources?: Source[]; onOpen: (label: string) => void }) {
  const cited = [...new Set(labelsIn(text))].filter((l) => sources.some((s) => s.label === l));
  if (!cited.length) return null;
  const sorted = cited.sort((a, b) => (parseInt(a.slice(5)) || 0) - (parseInt(b.slice(5)) || 0));
  return (
    <div className="cites">
      {sorted.map((label) => {
        const s = sources.find((x) => x.label === label)!;
        return (
          <button key={label} type="button" className="cite" onClick={() => onOpen(label)}>
            {label}{s.section ? ` · ${s.title.replace(/ \(part \d+ of \d+\)$/, "")}` : ""}
          </button>
        );
      })}
    </div>
  );
}
