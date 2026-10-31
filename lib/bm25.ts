// Small BM25 keyword search. Fast enough to rebuild on every cold start for ~70 chunks.

const STOP = new Set(
  "a an and are as at be by can do does for from has have how i if in is it its me my of on or shall that the their them there these this to under was what when where which who why will with would you your".split(" ")
);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

// Very light stemmer so "processing" matches "processed", "penalties" matches "penalty", etc.
function stem(t: string): string {
  if (t.length > 5 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("ed")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

export class BM25 {
  private docs: Map<string, number>[] = [];
  private lens: number[] = [];
  private df = new Map<string, number>();
  private avg = 0;

  constructor(texts: string[], private k1 = 1.4, private b = 0.75) {
    for (const text of texts) {
      const tf = new Map<string, number>();
      const toks = tokenize(text);
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push(tf);
      this.lens.push(toks.length);
    }
    this.avg = this.lens.reduce((a, b) => a + b, 0) / Math.max(1, this.lens.length);
  }

  /** Returns [docIndex, score] pairs, best first, score > 0 only. */
  search(query: string): [number, number][] {
    const q = [...new Set(tokenize(query))];
    const N = this.docs.length;
    const out: [number, number][] = [];
    this.docs.forEach((tf, i) => {
      let score = 0;
      for (const t of q) {
        const f = tf.get(t);
        if (!f) continue;
        const df = this.df.get(t)!;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        score += idf * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * this.lens[i]) / this.avg)));
      }
      if (score > 0) out.push([i, score]);
    });
    return out.sort((a, b) => b[1] - a[1]);
  }
}
