/**
 * Pure mathematical vector and semantic chunking module for client-side RAG.
 *
 * Cosine similarity relation:
 *   cos(θ) = (u · v) / (||u||₂ · ||v||₂)
 *
 * Known textbook verification cases:
 *   1. Identical non-zero vector: cos([3, 4], [3, 4]) = 25 / (5 * 5) = 1.0
 *   2. Orthogonal basis vectors: cos([1, 0], [0, 1]) = 0 / (1 * 1) = 0.0
 *   3. Invariant: For any finite non-zero vectors u, v, -1 <= cos(u, v) <= 1 (Cauchy-Schwarz).
 */

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < len; i++) {
    const va = a[i] || 0;
    const vb = b[i] || 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0 || !Number.isFinite(denom)) return 0;

  const raw = dot / denom;
  return Math.max(-1, Math.min(1, raw));
}

/**
 * Deterministic L2-normalized local lexical-trigram embedding (256 dimensions).
 * Used synchronously for zero-latency initial vector indexing before or alongside
 * Gemini `gemini-embedding-2` dense vector hydration so cosine similarity is
 * always mathematically well-defined even offline.
 */
const LOCAL_DIM = 256;

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was', 'were',
  'have', 'has', 'had', 'not', 'but', 'what', 'when', 'where', 'which', 'who',
  'how', 'why', 'into', 'your', 'their', 'about', 'can', 'will', 'does', 'into',
]);

function fnv1aHash(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function computeDeterministicEmbedding(text: string): number[] {
  const vec = new Array<number>(LOCAL_DIM).fill(0);
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9α-ωσλθ∑√_+-]+/gi, ' ')
    .trim();

  if (!normalized) return vec;

  const tokens = normalized.split(/\s+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];
    const stem = word.length > 5 ? word.replace(/(ing|tion|ions|ed|es|s)$/, '') : word;

    // Unigram feature
    const h1 = fnv1aHash(stem);
    const idx1 = h1 % LOCAL_DIM;
    const sign1 = (h1 & 256) === 0 ? 1 : -1;
    vec[idx1] += sign1 * 1.6;

    // Bigram phrase feature
    if (i + 1 < tokens.length) {
      const bigram = `${stem}_${tokens[i + 1].slice(0, 6)}`;
      const h2 = fnv1aHash(bigram);
      vec[h2 % LOCAL_DIM] += ((h2 & 512) === 0 ? 1 : -1) * 1.1;
    }

    // Character 4-gram features for technical terms and formulas
    if (word.length >= 4) {
      for (let c = 0; c <= word.length - 4; c++) {
        const gram = word.slice(c, c + 4);
        const hg = fnv1aHash(gram);
        vec[hg % LOCAL_DIM] += ((hg & 1024) === 0 ? 1 : -1) * 0.45;
      }
    }
  }

  let norm = 0;
  for (let i = 0; i < LOCAL_DIM; i++) norm += vec[i] * vec[i];
  const mag = Math.sqrt(norm);
  if (mag > 0) {
    for (let i = 0; i < LOCAL_DIM; i++) vec[i] = Number((vec[i] / mag).toFixed(5));
  }
  return vec;
}

export interface RawPageText {
  pageNumber: number;
  text: string;
}

export interface SemanticChunkInput {
  pageNumber: number;
  chunkIndex: number;
  sectionHeading?: string;
  text: string;
  charCount: number;
  overlapChars: number;
}

/**
 * Splits extracted document pages into overlapping semantic chunks on paragraph
 * and sentence boundaries (default target ~680 chars, ~130-char sliding overlap).
 */
export function splitIntoOverlappingChunks(
  pages: RawPageText[],
  targetChars = 680,
  overlapChars = 130
): SemanticChunkInput[] {
  const results: SemanticChunkInput[] = [];
  let globalIndex = 1;
  let lastHeading: string | undefined;

  for (const page of pages) {
    const cleaned = page.text
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!cleaned) continue;

    // Detect section headings at line starts (e.g., "1.2 Ridge Regression" or "Section 3:")
    const lines = cleaned.split('\n');
    const segments: Array<{ heading?: string; body: string }> = [];
    let buffer: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      const looksLikeHeading =
        trimmed.length > 3 &&
        trimmed.length < 78 &&
        !trimmed.endsWith('.') &&
        (/^(\d+(\.\d+)*\s+[A-Z]|Lecture\s+\d+|Section\s+\d+|Lab\s+Protocol|Theorem|Definition)/i.test(
          trimmed
        ) ||
          /^[A-Z][A-Za-z0-9\s\-:&()]{4,60}$/.test(trimmed));

      if (looksLikeHeading) {
        if (buffer.length > 0) {
          segments.push({ heading: lastHeading, body: buffer.join('\n').trim() });
          buffer = [];
        }
        lastHeading = trimmed;
        buffer.push(trimmed);
      } else {
        buffer.push(line);
      }
    }
    if (buffer.length > 0) {
      segments.push({ heading: lastHeading, body: buffer.join('\n').trim() });
    }

    const fullText = cleaned;
    // Sentence-aware sliding window across the page
    const sentences = fullText
      .split(/(?<=[.!?])\s+(?=[A-Z0-9(\[])|\n\n+/)
      .map((s) => s.trim())
      .filter(Boolean);

    let current = '';
    let usedOverlap = 0;

    for (const sentence of sentences) {
      if ((current + ' ' + sentence).trim().length <= targetChars || current.length < 220) {
        current = current ? `${current} ${sentence}` : sentence;
      } else {
        const headingForChunk = detectHeadingInChunk(current) || lastHeading;
        results.push({
          pageNumber: page.pageNumber,
          chunkIndex: globalIndex++,
          sectionHeading: headingForChunk,
          text: current.trim(),
          charCount: current.trim().length,
          overlapChars: usedOverlap,
        });

        // Carry trailing overlap words into next chunk
        const tail = extractTrailingOverlap(current, overlapChars);
        usedOverlap = tail.length;
        current = tail ? `${tail} ${sentence}` : sentence;
      }
    }

    if (current.trim().length > 0) {
      const headingForChunk = detectHeadingInChunk(current) || lastHeading;
      results.push({
        pageNumber: page.pageNumber,
        chunkIndex: globalIndex++,
        sectionHeading: headingForChunk,
        text: current.trim(),
        charCount: current.trim().length,
        overlapChars: usedOverlap,
      });
    }
  }

  return results;
}

function detectHeadingInChunk(text: string): string | undefined {
  const firstLine = text.split('\n')[0]?.trim();
  if (
    firstLine &&
    firstLine.length <= 75 &&
    !firstLine.endsWith('.') &&
    /^(\d+(\.\d+)*\s+|Lecture|Section|Lab\s+Protocol|Part\s+[A-Z0-9])/i.test(firstLine)
  ) {
    return firstLine;
  }
  return undefined;
}

function extractTrailingOverlap(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const slice = trimmed.slice(trimmed.length - maxChars);
  const firstSpace = slice.indexOf(' ');
  return firstSpace > 0 ? slice.slice(firstSpace + 1).trim() : slice.trim();
}
