export type Chunk = {
  id: string;
  section: number | null;
  label: string; // e.g. "Sec. 16" or "Title & Approval"
  title: string;
  chapter: string;
  text: string;
  embedding?: number[];
};

export type Source = Pick<Chunk, "id" | "section" | "label" | "title" | "chapter" | "text">;

export type ChatMessage = { role: "user" | "assistant"; content: string };

// Lines streamed from /api/chat (newline-delimited JSON)
export type StreamEvent =
  | { type: "sources"; sources: Source[] }
  | { type: "text"; value: string }
  | { type: "reset" } // discard the partial answer; a retry follows
  | { type: "done"; provider: string }
  | { type: "error"; message: string };
