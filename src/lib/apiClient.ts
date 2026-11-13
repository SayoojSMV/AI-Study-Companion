import {
  computeDeterministicEmbedding,
  cosineSimilarity,
} from '../model/vectorMath';
import type {
  CitationRef,
  DocumentChunk,
  QuizQuestion,
  RevisionSummary,
  TutorMode,
} from '../types';

export interface EmbedResponse {
  embeddings: number[][];
  model: string;
  dimensions: number;
}

export async function generateGeminiEmbeddings(texts: string[]): Promise<EmbedResponse> {
  const response = await fetch('/api/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Embedding request failed (${response.status})`);
  }
  return data as EmbedResponse;
}

export interface RetrievalResult {
  topChunks: Array<DocumentChunk & { similarity: number }>;
  citations: CitationRef[];
  hydratedChunks?: DocumentChunk[];
  vectorEngine: string;
}

/**
 * Performs semantic cosine-similarity retrieval across candidate chunks.
 * Uses Gemini `gemini-embedding-2` dense vectors when available (hydrating chunks
 * on first search if needed), and falls back cleanly to deterministic L2-normalized
 * vectors if the server embedding endpoint is unreachable.
 */
export async function retrieveSemanticChunks(
  query: string,
  candidateChunks: DocumentChunk[],
  topK = 4
): Promise<RetrievalResult> {
  if (candidateChunks.length === 0) {
    return {
      topChunks: [],
      citations: [],
      vectorEngine: 'gemini-embedding-2',
    };
  }

  let updatedChunks: DocumentChunk[] | undefined;
  let workingChunks = candidateChunks;
  let queryGeminiVec: number[] | null = null;
  let vectorEngine = 'gemini-embedding-2';

  try {
    const missingChunks = candidateChunks.filter(
      (c) => !c.geminiEmbedding || c.geminiEmbedding.length === 0
    );

    if (missingChunks.length > 0) {
      const batchTexts = [query, ...missingChunks.map((c) => c.text)];
      const embedRes = await generateGeminiEmbeddings(batchTexts);
      if (embedRes.embeddings.length === batchTexts.length) {
        queryGeminiVec = embedRes.embeddings[0];
        const vecByChunkId = new Map<string, number[]>();
        missingChunks.forEach((c, idx) => {
          vecByChunkId.set(c.id, embedRes.embeddings[idx + 1]);
        });
        updatedChunks = candidateChunks.map((c) =>
          vecByChunkId.has(c.id)
            ? { ...c, geminiEmbedding: vecByChunkId.get(c.id) }
            : c
        );
        workingChunks = updatedChunks;
      }
    } else {
      const embedRes = await generateGeminiEmbeddings([query]);
      if (embedRes.embeddings[0]?.length) {
        queryGeminiVec = embedRes.embeddings[0];
      }
    }
  } catch {
    // Fall back to deterministic L2-normalized cosine store so search remains uninterrupted
    queryGeminiVec = null;
    vectorEngine = 'local-cosine-256d';
  }

  const localQueryVec = computeDeterministicEmbedding(query);

  const scored = workingChunks.map((chunk) => {
    const useGemini =
      queryGeminiVec !== null &&
      chunk.geminiEmbedding &&
      chunk.geminiEmbedding.length === queryGeminiVec.length;

    const sim = useGemini
      ? cosineSimilarity(queryGeminiVec!, chunk.geminiEmbedding!)
      : cosineSimilarity(localQueryVec, chunk.localEmbedding);

    return { ...chunk, similarity: sim };
  });

  scored.sort((a, b) => b.similarity - a.similarity);
  const top = scored.slice(0, topK);

  const citations: CitationRef[] = top.map((c) => ({
    chunkId: c.id,
    docTitle: c.docTitle,
    pageNumber: c.pageNumber,
    chunkIndex: c.chunkIndex,
    sectionHeading: c.sectionHeading,
    snippet: c.text,
    similarity: c.similarity,
  }));

  return {
    topChunks: top,
    citations,
    hydratedChunks: updatedChunks,
    vectorEngine,
  };
}

export interface ChatApiResult {
  answer: string;
  groundedInNotes: boolean;
  primarySource: 'uploaded_notes' | 'general_knowledge' | 'not_in_notes';
  provenanceSummary?: string;
  citedPassageIndices: number[];
}

export async function requestTutorChat(params: {
  question: string;
  mode: TutorMode | 'ungrounded';
  chunks?: Array<DocumentChunk & { similarity: number }>;
  history?: Array<{ role: 'user' | 'model'; text: string }>;
}): Promise<ChatApiResult> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: params.question,
      mode: params.mode,
      chunks: (params.chunks ?? []).map((c) => ({
        chunkIndex: c.chunkIndex,
        pageNumber: c.pageNumber,
        docTitle: c.docTitle,
        sectionHeading: c.sectionHeading,
        text: c.text,
        similarity: c.similarity,
      })),
      history: params.history ?? [],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Chat request failed (${response.status})`);
  }
  return {
    answer: data.answer ?? '',
    groundedInNotes: Boolean(data.groundedInNotes),
    primarySource: data.primarySource ?? 'uploaded_notes',
    provenanceSummary: data.provenanceSummary,
    citedPassageIndices: Array.isArray(data.citedPassageIndices)
      ? data.citedPassageIndices
      : [],
  };
}

export async function requestRevisionSummary(
  docTitle: string,
  chunks: DocumentChunk[]
): Promise<Omit<RevisionSummary, 'id' | 'docId' | 'docTitle' | 'createdAt'>> {
  const response = await fetch('/api/summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      docTitle,
      chunks: chunks.map((c) => ({
        chunkIndex: c.chunkIndex,
        pageNumber: c.pageNumber,
        sectionHeading: c.sectionHeading,
        text: c.text,
      })),
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Summary generation failed (${response.status})`);
  }
  return data.summary;
}

export async function requestPracticeQuiz(
  docTitle: string,
  chunks: DocumentChunk[],
  seedNonce = Date.now()
): Promise<QuizQuestion[]> {
  const response = await fetch('/api/quiz', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      docTitle,
      seedNonce,
      chunks: chunks.map((c) => ({
        chunkIndex: c.chunkIndex,
        pageNumber: c.pageNumber,
        sectionHeading: c.sectionHeading,
        text: c.text,
      })),
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Quiz generation failed (${response.status})`);
  }
  return data.questions ?? [];
}
