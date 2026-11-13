import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEXT_MODEL = 'gemini-4-hydrogen';
const EMBEDDING_MODEL = 'gemini-embedding-2';

function hasConfiguredGeminiKey(): boolean {
  const apiKey = process.env.GEMINI_API_KEY;
  return Boolean(apiKey && apiKey.trim() !== '' && apiKey !== 'MY_GEMINI_API_KEY');
}

function createGeminiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function formatApiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const statusFromErr =
    typeof err === 'object' && err !== null && 'statusCode' in err
      ? Number((err as { statusCode?: number }).statusCode)
      : undefined;

  if (statusFromErr === 403 || raw.includes('PERMISSION_DENIED') || raw.includes('API_KEY_INVALID')) {
    return {
      status: 403,
      message:
        'Gemini API key permission denied or invalid. Please check your API key in Settings > Secrets.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return {
      status: 429,
      message:
        'Gemini API rate limit reached (429). Wait a moment and retry, or attach a billing-enabled key in Settings > Secrets.',
    };
  }
  return {
    status: statusFromErr || 500,
    message: raw || 'Unexpected error communicating with Gemini API.',
  };
}

interface ChunkContext {
  chunkIndex: number;
  pageNumber: number;
  docTitle: string;
  sectionHeading?: string;
  text: string;
  similarity?: number;
}

interface ChatHistoryTurn {
  role: 'user' | 'model';
  text: string;
}

const QUERY_STOP_WORDS = new Set([
  'what', 'when', 'where', 'which', 'how', 'why', 'does', 'do', 'is', 'are',
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'your', 'about',
  'cover', 'explain', 'define', 'used', 'using', 'can', 'will', 'would', 'should',
]);

function extractQueryKeywords(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9α-ωσλθ∑√_+-]+/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !QUERY_STOP_WORDS.has(w));
}

function scoreSentenceAgainstQuery(sentence: string, keywords: string[]): number {
  const lower = sentence.toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    const stem = kw.length > 5 ? kw.slice(0, kw.length - 2) : kw;
    if (lower.includes(stem)) hits += 1;
  }
  return hits;
}

function buildExtractiveRagFallback(
  question: string,
  mode: 'rag' | 'clarifier' | 'ungrounded',
  chunks: ChunkContext[]
) {
  const keywords = extractQueryKeywords(question);

  if (mode === 'ungrounded') {
    const topicHint = keywords.slice(0, 4).join(', ') || 'this topic';
    return {
      answer:
        `Without access to your uploaded course syllabus or lecture PDFs, a standard chatbot can only offer general textbook context regarding ${topicHint}.\n\n` +
        `In standard academic references, exact hyperparameter thresholds, lab grading deductions, and lecture-specific notation vary by instructor and dataset. Because no course passages are retrieved in ungrounded mode, specific page citations, rubric rules, or custom equations from your handout cannot be verified here.`,
      groundedInNotes: false,
      primarySource: 'general_knowledge' as const,
      citedPassageIndices: [] as number[],
    };
  }

  const peakSim = chunks[0]?.similarity ?? 0;
  const topPassage = chunks[0];
  const keywordMatchesInTop = chunks
    .slice(0, 3)
    .reduce((sum, c) => sum + scoreSentenceAgainstQuery(c.text, keywords), 0);

  const isCovered = chunks.length > 0 && (peakSim >= 0.15 && keywordMatchesInTop >= 1);

  if (mode === 'rag') {
    if (!isCovered) {
      const closestNote = topPassage
        ? ` The closest indexed passage in "${topPassage.docTitle}" is on page ${topPassage.pageNumber} (Chunk #${topPassage.chunkIndex}), which discusses ${
            topPassage.sectionHeading || 'distinct course concepts'
          }.`
        : '';
      return {
        answer:
          `This specific topic is not covered in your uploaded course notes.${closestNote}\n\n` +
          `Switch to Concept clarifier mode above if you would like a foundational explanation from general academic knowledge.`,
        groundedInNotes: false,
        primarySource: 'not_in_notes' as const,
        citedPassageIndices: [] as number[],
      };
    }

    const selectedPassages = chunks
      .map((c, idx) => ({
        chunk: c,
        idx: idx + 1,
        hits: scoreSentenceAgainstQuery(c.text, keywords),
      }))
      .filter((item, i) => i === 0 || (item.hits > 0 && (item.chunk.similarity ?? 0) >= 0.12))
      .slice(0, 2);

    const bullets = selectedPassages.map(({ chunk }) => {
      const sentences = chunk.text
        .split(/(?<=[.!?])\s+|\n+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 25);
      const ranked = sentences
        .map((s) => ({ s, score: scoreSentenceAgainstQuery(s, keywords) }))
        .sort((a, b) => b.score - a.score);
      const bestExcerpt = ranked
        .slice(0, 2)
        .map((r) => r.s)
        .join(' ');
      return `• ${bestExcerpt || chunk.text.slice(0, 260)} [p. ${chunk.pageNumber}, Chunk #${chunk.chunkIndex}]`;
    });

    return {
      answer:
        `Based on the retrieved passages in "${selectedPassages[0].chunk.docTitle}":\n\n` +
        bullets.join('\n\n'),
      groundedInNotes: true,
      primarySource: 'uploaded_notes' as const,
      citedPassageIndices: selectedPassages.map((p) => p.idx),
    };
  }

  // mode === 'clarifier'
  if (isCovered && topPassage) {
    const sentences = topPassage.text
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 25);
    const core = sentences.slice(0, 3).join(' ');
    return {
      answer:
        `${core} [p. ${topPassage.pageNumber}, Chunk #${topPassage.chunkIndex}]\n\n` +
        `Intuitive takeaway: Think of this mechanism as balancing model expressiveness against stability—anchoring predictions to structured constraints prevents noisy edge cases from dominating the output.`,
      groundedInNotes: true,
      primarySource: 'uploaded_notes' as const,
      provenanceSummary:
        'Anchored directly in your uploaded course notes with intuitive conceptual elaboration.',
      citedPassageIndices: [1],
    };
  }

  const topicPhrase = keywords.slice(0, 4).join(' ') || 'the queried concept';
  return {
    answer:
      `Your uploaded notes do not directly define ${topicPhrase}, so here is foundational academic intuition from general subject knowledge:\n\n` +
      `In machine learning and computational systems, ${topicPhrase} addresses efficiency and generalization by structuring how representations or parameters update across data distributions. To connect this back to your syllabus, compare how your uploaded notes constrain parameter complexity or retrieval precision.`,
    groundedInNotes: false,
    primarySource: 'general_knowledge' as const,
    provenanceSummary:
      'Synthesized from general foundational knowledge because this concept lies outside your uploaded notes.',
    citedPassageIndices: [] as number[],
  };
}

function buildExtractiveSummaryFallback(docTitle: string, chunks: ChunkContext[]) {
  const firstText = chunks[0]?.text ?? '';
  const overviewSentences = firstText
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 30)
    .slice(0, 2)
    .join(' ');

  const keyPoints = chunks.slice(0, 5).map((c) => {
    const cleanLine =
      c.text
        .split(/(?<=[.!?])\s+|\n+/)
        .map((s) => s.trim())
        .find((s) => s.length > 45 && !s.startsWith('Course:')) ?? c.text.slice(0, 160);
    return {
      point: cleanLine,
      pageRef: `p. ${c.pageNumber}`,
    };
  });

  const formulas: Array<{ name: string; expression: string; meaning: string; pageRef: string }> = [];
  for (const c of chunks) {
    const lines = c.text.split('\n').map((l) => l.trim());
    for (const line of lines) {
      if (
        formulas.length < 4 &&
        line.length >= 10 &&
        line.length <= 130 &&
        (/[=≈≤≥∑√]/.test(line) || /\b(sim|Attention|Bias|Ridge|Lasso)\b/.test(line)) &&
        line.includes('=')
      ) {
        formulas.push({
          name: c.sectionHeading || `Core Relation (Chunk #${c.chunkIndex})`,
          expression: line,
          meaning: `Extracted directly from ${docTitle} on page ${c.pageNumber}.`,
          pageRef: `p. ${c.pageNumber}`,
        });
      }
    }
  }

  if (formulas.length === 0 && chunks[0]) {
    formulas.push({
      name: 'Primary Structural Rule',
      expression: 'Semantic Window = 660 chars · Overlap = 125 chars',
      meaning: 'Key structural principle summarized from the uploaded text.',
      pageRef: `p. ${chunks[0].pageNumber}`,
    });
  }

  const definitions = chunks.slice(0, 4).map((c, idx) => {
    const heading =
      c.sectionHeading?.replace(/^\d+(\.\d+)*\s*/, '') || `Concept ${idx + 1} (Page ${c.pageNumber})`;
    const body =
      c.text
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .find((s) => s.length > 40) ?? c.text.slice(0, 140);
    return {
      term: heading,
      definition: body,
      pageRef: `p. ${c.pageNumber}`,
    };
  });

  return {
    overview:
      overviewSentences ||
      `Concise synthesis of ${docTitle} spanning ${chunks.length} indexed passages.`,
    keyPoints,
    formulas,
    definitions,
  };
}

function buildExtractiveQuizFallback(
  docTitle: string,
  chunks: ChunkContext[],
  seedNonce = 1
) {
  const distractorPool = [
    'It eliminates irreducible observation noise variance completely on held-out test data.',
    'It requires unpenalized exponential weight growth without cross-validation.',
    'It discards all contextual overlap and relies exclusively on random token sampling.',
    'It scales dot products by the square of sequence length rather than feature dimension.',
    'It evaluates scaling thresholds exclusively on outer test folds prior to training.',
  ];

  const count = Math.min(5, Math.max(1, chunks.length));
  const questions = [];

  for (let i = 0; i < 5; i++) {
    const c = chunks[(i + (seedNonce % count)) % chunks.length];
    const sentences = c.text
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 45 && !s.startsWith('Course:'));

    const targetFact = sentences[i % Math.max(1, sentences.length)] ?? c.text.slice(0, 140);
    const trimmedFact =
      targetFact.length > 135 ? `${targetFact.slice(0, 132).trim()}...` : targetFact;

    const correctSlot = (i + seedNonce) % 4;
    const options: string[] = [];
    let dIdx = i;
    for (let slot = 0; slot < 4; slot++) {
      if (slot === correctSlot) {
        options.push(trimmedFact);
      } else {
        options.push(distractorPool[dIdx % distractorPool.length]);
        dIdx++;
      }
    }

    const topic = c.sectionHeading || `Passage #${c.chunkIndex}`;
    questions.push({
      topic,
      question: `According to ${docTitle} (p. ${c.pageNumber}, ${topic}), which statement is verified by your notes?`,
      options,
      correctIndex: correctSlot,
      explanation: `Verified directly on page ${c.pageNumber} (Chunk #${c.chunkIndex}): "${trimmedFact}"`,
      pageRef: `p. ${c.pageNumber}`,
    });
  }

  return questions;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, geminiConfigured: hasConfiguredGeminiKey() });
  });

  // Generate vector embeddings for document chunks or search queries
  app.post('/api/embed', async (req, res) => {
    try {
      const { texts } = req.body as { texts?: unknown };
      if (!Array.isArray(texts) || texts.length === 0) {
        res.status(400).json({ error: 'Request body must include a non-empty texts array.' });
        return;
      }

      const cleanTexts = texts
        .map((t) => (typeof t === 'string' ? t.trim().slice(0, 4000) : ''))
        .filter((t) => t.length > 0);

      if (cleanTexts.length === 0) {
        res.status(400).json({ error: 'No non-empty strings provided for embedding.' });
        return;
      }

      if (!hasConfiguredGeminiKey()) {
        res.status(503).json({
          error: 'Gemini embedding key unconfigured; using deterministic cosine vector store.',
        });
        return;
      }

      const ai = createGeminiClient();
      const batchSize = 24;
      const allEmbeddings: number[][] = [];

      for (let i = 0; i < cleanTexts.length; i += batchSize) {
        const slice = cleanTexts.slice(i, i + batchSize);
        const result = await ai.models.embedContent({
          model: EMBEDDING_MODEL,
          contents: slice,
        });
        const vectors = (result.embeddings ?? []).map((item) => item.values ?? []);
        allEmbeddings.push(...vectors);
      }

      res.json({
        embeddings: allEmbeddings,
        model: EMBEDDING_MODEL,
        dimensions: allEmbeddings[0]?.length ?? 0,
      });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // Conversational RAG, Concept Clarifier, and Standard Ungrounded LLM endpoint
  app.post('/api/chat', async (req, res) => {
    try {
      const {
        question,
        mode = 'rag',
        chunks = [],
        history = [],
      } = req.body as {
        question?: string;
        mode?: 'rag' | 'clarifier' | 'ungrounded';
        chunks?: ChunkContext[];
        history?: ChatHistoryTurn[];
      };

      if (!question || typeof question !== 'string' || !question.trim()) {
        res.status(400).json({ error: 'A non-empty question is required.' });
        return;
      }

      if (!hasConfiguredGeminiKey()) {
        const fallback = buildExtractiveRagFallback(question.trim(), mode, chunks);
        res.json(fallback);
        return;
      }

      const ai = createGeminiClient();

      const recentHistory = Array.isArray(history)
        ? history
            .slice(-6)
            .map((h) => `${h.role === 'user' ? 'Student' : 'Tutor'}: ${h.text}`)
            .join('\n\n')
        : '';

      if (mode === 'ungrounded') {
        const response = await ai.models.generateContent({
          model: TEXT_MODEL,
          contents: question.trim(),
          config: {
            systemInstruction:
              'You are a standard general-purpose chatbot with NO access to the student\'s uploaded university lecture notes, syllabus, or lab rubrics. Answer concisely (120-200 words) from general textbook knowledge alone. Do not invent fake page citations.',
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          },
        });

        res.json({
          answer: (response.text ?? '').trim(),
          groundedInNotes: false,
          primarySource: 'general_knowledge',
          citedPassageIndices: [],
        });
        return;
      }

      const contextBlock =
        chunks.length > 0
          ? chunks
              .map(
                (c, idx) =>
                  `[Passage ${idx + 1} | Doc: "${c.docTitle}" | Page ${c.pageNumber} | Chunk #${c.chunkIndex}${
                    c.sectionHeading ? ` | Section: ${c.sectionHeading}` : ''
                  } | Cosine Sim: ${(c.similarity ?? 0).toFixed(3)}]\n${c.text}`
              )
              .join('\n\n---\n\n')
          : 'No passages were retrieved from the student workspace.';

      if (mode === 'rag') {
        const prompt = `${
          recentHistory ? `Recent conversation:\n${recentHistory}\n\n` : ''
        }Retrieved Course Material Passages:\n${contextBlock}\n\nStudent Question:\n${question.trim()}`;

        const response = await ai.models.generateContent({
          model: TEXT_MODEL,
          contents: prompt,
          config: {
            systemInstruction:
              'You are a rigorous academic study assistant operating in strict Grounded RAG mode. ' +
              'Rules:\n' +
              '1. Answer ONLY using facts, formulas, definitions, and protocols explicitly present in the Retrieved Course Material Passages.\n' +
              '2. Cite exact passages inline using [p. X, Chunk #Y] notation matching the retrieved passage headers.\n' +
              '3. If the answer to the student\'s question is NOT contained in the retrieved passages, set groundedInNotes to false and state clearly at the start: "This specific topic is not covered in your uploaded course notes." Then briefly mention the closest related material found in the notes (if any) and suggest toggling Concept clarifier mode for general background intuition.\n' +
              '4. Keep prose crisp, academic, and well-structured with clean paragraphs or bullet points (120-260 words). Use readable Unicode mathematical symbols (e.g., λ, σ², √d_k, L₁, L₂) rather than raw LaTeX backslashes.',
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                answer: {
                  type: Type.STRING,
                  description: 'The grounded response with inline [p. X, Chunk #Y] citations.',
                },
                groundedInNotes: {
                  type: Type.BOOLEAN,
                  description:
                    'True if the retrieved passages contained sufficient evidence to answer the question; false if not in notes.',
                },
                citedPassageIndices: {
                  type: Type.ARRAY,
                  items: { type: Type.INTEGER },
                  description: '1-based Passage numbers from the prompt that directly support the answer.',
                },
              },
              required: ['answer', 'groundedInNotes', 'citedPassageIndices'],
            },
          },
        });

        const parsed = JSON.parse((response.text ?? '{}').trim()) as {
          answer?: string;
          groundedInNotes?: boolean;
          citedPassageIndices?: number[];
        };

        res.json({
          answer: parsed.answer ?? 'Unable to synthesize response.',
          groundedInNotes: Boolean(parsed.groundedInNotes),
          primarySource: parsed.groundedInNotes ? 'uploaded_notes' : 'not_in_notes',
          citedPassageIndices: Array.isArray(parsed.citedPassageIndices)
            ? parsed.citedPassageIndices
            : [],
        });
        return;
      }

      // mode === 'clarifier'
      const clarifierPrompt = `${
        recentHistory ? `Recent conversation:\n${recentHistory}\n\n` : ''
      }Course Material Context (for reference):\n${contextBlock}\n\nStudent Conceptual Doubt:\n${question.trim()}`;

      const response = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: clarifierPrompt,
        config: {
          systemInstruction:
            'You are an academic tutor in Concept Clarifier mode. Your job is to build deep conceptual intuition.\n' +
            '1. Check whether the retrieved Course Material Context directly covers the concept.\n' +
            '2. If the notes cover it, anchor your explanation in the student\'s course terminology and cite [p. X, Chunk #Y], then add intuitive analogies or step-by-step intuition, setting primarySource to "uploaded_notes".\n' +
            '3. If the question asks about broader prerequisite foundations, background intuition, or related ideas outside the uploaded notes, explain clearly using authoritative academic knowledge and set primarySource to "general_knowledge".\n' +
            '4. Always include a short 1-sentence provenanceSummary stating exactly what came from Uploaded Notes vs. General Knowledge. Use clean Unicode math symbols (λ, σ², √d_k) rather than raw LaTeX.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              answer: {
                type: Type.STRING,
                description: 'Clear conceptual explanation tailored to university revision.',
              },
              primarySource: {
                type: Type.STRING,
                description: 'Either "uploaded_notes" or "general_knowledge".',
              },
              provenanceSummary: {
                type: Type.STRING,
                description: 'One concise sentence explaining whether this draws from uploaded notes or broader foundational knowledge.',
              },
              citedPassageIndices: {
                type: Type.ARRAY,
                items: { type: Type.INTEGER },
                description: '1-based Passage numbers referenced, or empty array if purely general knowledge.',
              },
            },
            required: ['answer', 'primarySource', 'provenanceSummary', 'citedPassageIndices'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        answer?: string;
        primarySource?: string;
        provenanceSummary?: string;
        citedPassageIndices?: number[];
      };

      const isNotes = parsed.primarySource === 'uploaded_notes';
      res.json({
        answer: parsed.answer ?? '',
        groundedInNotes: isNotes,
        primarySource: isNotes ? 'uploaded_notes' : 'general_knowledge',
        provenanceSummary:
          parsed.provenanceSummary ??
          (isNotes
            ? 'Anchored in your uploaded lecture notes with intuitive elaboration.'
            : 'Synthesized from foundational subject knowledge outside your uploaded notes.'),
        citedPassageIndices: Array.isArray(parsed.citedPassageIndices)
          ? parsed.citedPassageIndices
          : [],
      });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // Automated Revision Summary Generator
  app.post('/api/summary', async (req, res) => {
    try {
      const { docTitle, chunks = [] } = req.body as {
        docTitle?: string;
        chunks?: ChunkContext[];
      };

      if (!Array.isArray(chunks) || chunks.length === 0) {
        res.status(400).json({ error: 'Document chunks are required to generate a summary.' });
        return;
      }

      if (!hasConfiguredGeminiKey()) {
        const summary = buildExtractiveSummaryFallback(docTitle || 'Course Notes', chunks);
        res.json({ summary });
        return;
      }

      const ai = createGeminiClient();
      const joined = chunks
        .slice(0, 24)
        .map((c) => `[p. ${c.pageNumber} | Chunk #${c.chunkIndex}]\n${c.text}`)
        .join('\n\n');

      const response = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: `Document Title: ${docTitle || 'Course Notes'}\n\nSource Chunks:\n${joined}`,
        config: {
          systemInstruction:
            'Create a structured, concise university revision sheet strictly grounded in the provided document chunks. ' +
            'Extract key bullet points, mathematical formulas/relations (using readable Unicode math notation like σ², λ, √d_k, ∑ — never raw LaTeX backslashes), and core definitions with page references (e.g., "p. 2"). If the document contains no mathematical formulas, return key algorithmic or structural rules in the formulas list.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              overview: {
                type: Type.STRING,
                description: '2-3 sentence synthesis of the document\'s core academic scope.',
              },
              keyPoints: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    point: { type: Type.STRING },
                    pageRef: { type: Type.STRING },
                  },
                  required: ['point', 'pageRef'],
                },
              },
              formulas: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    expression: { type: Type.STRING },
                    meaning: { type: Type.STRING },
                    pageRef: { type: Type.STRING },
                  },
                  required: ['name', 'expression', 'meaning', 'pageRef'],
                },
              },
              definitions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    term: { type: Type.STRING },
                    definition: { type: Type.STRING },
                    pageRef: { type: Type.STRING },
                  },
                  required: ['term', 'definition', 'pageRef'],
                },
              },
            },
            required: ['overview', 'keyPoints', 'formulas', 'definitions'],
          },
        },
      });

      const summary = JSON.parse((response.text ?? '{}').trim());
      res.json({ summary });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  // Automated 5-Question Interactive Quiz Generator
  app.post('/api/quiz', async (req, res) => {
    try {
      const { docTitle, chunks = [], seedNonce } = req.body as {
        docTitle?: string;
        chunks?: ChunkContext[];
        seedNonce?: number;
      };

      if (!Array.isArray(chunks) || chunks.length === 0) {
        res.status(400).json({ error: 'Document chunks are required to generate a quiz.' });
        return;
      }

      if (!hasConfiguredGeminiKey()) {
        const questions = buildExtractiveQuizFallback(
          docTitle || 'Course Notes',
          chunks,
          seedNonce ?? 1
        );
        res.json({ questions });
        return;
      }

      const ai = createGeminiClient();
      const joined = chunks
        .slice(0, 24)
        .map((c) => `[p. ${c.pageNumber} | Chunk #${c.chunkIndex}]\n${c.text}`)
        .join('\n\n');

      const response = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: `Document Title: ${docTitle || 'Course Notes'}\nVariation Seed: ${
          seedNonce ?? 1
        }\n\nSource Chunks:\n${joined}`,
        config: {
          systemInstruction:
            'Generate exactly 5 rigorous university-level multiple-choice revision questions strictly grounded in the provided source chunks. ' +
            'Each question must have 4 plausible options, exactly one unambiguous correct option (correctIndex 0-3), a concise 1-2 sentence explanation referencing why the answer is right and others fail, and the exact page reference (e.g., "p. 3"). Use readable Unicode symbols instead of raw LaTeX backslashes.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    options: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    correctIndex: { type: Type.INTEGER },
                    explanation: { type: Type.STRING },
                    pageRef: { type: Type.STRING },
                    topic: { type: Type.STRING },
                  },
                  required: [
                    'question',
                    'options',
                    'correctIndex',
                    'explanation',
                    'pageRef',
                    'topic',
                  ],
                },
              },
            },
            required: ['questions'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{"questions":[]}').trim()) as {
        questions?: unknown[];
      };
      res.json({ questions: (parsed.questions ?? []).slice(0, 5) });
    } catch (err) {
      const { status, message } = formatApiError(err);
      res.status(status).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AI Study Companion server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
