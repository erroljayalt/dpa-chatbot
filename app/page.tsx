"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import Chat, { SUGGESTIONS, type QueuedQuestion } from "@/components/Chat";

// Three.js only runs in the browser.
const DataCore = dynamic(() => import("@/components/DataCore"), { ssr: false });

export default function Home() {
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState<QueuedQuestion | null>(null);
  const onBusy = useCallback((b: boolean) => setBusy(b), []);

  return (
    <>
      <DataCore busy={busy} />
      <main className="wrap">
        <section className="intro">
          <div className="eyebrow">Republic Act No. 10173</div>
          <h1>Ask the Data Privacy Act</h1>
          <p>A chatbot that answers only from the text of the Data Privacy Act of 2012 and cites the Section behind every answer.</p>
          <div className="meta">
            <span>45 Sections</span>
            <span>9 Chapters</span>
            <span>Approved 15 Aug 2012</span>
          </div>
          <div className="try">
            <small>Try asking</small>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" disabled={busy} onClick={() => setQueued({ text: s, id: Date.now() })}>
                {s}
              </button>
            ))}
          </div>
        </section>
        <Chat onBusy={onBusy} queued={queued} />
      </main>
    </>
  );
}
