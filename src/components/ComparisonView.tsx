import { useEffect, useState, type FormEvent } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Loader2,
  Scale,
} from 'lucide-react';
import {
  requestTutorChat,
  retrieveSemanticChunks,
} from '../lib/apiClient';
import type {
  ComparisonRun,
  DocumentChunk,
  StudyDocument,
} from '../types';
import { Button, Surface } from './ui';

interface ComparisonViewProps {
  activeDoc: StudyDocument | null;
  comparisons: ComparisonRun[];
  pendingQuestion: string | null;
  onClearPendingQuestion: () => void;
  onSaveComparison: (run: ComparisonRun) => void;
  onHydrateDocChunks: (docId: string, updatedChunks: DocumentChunk[]) => void;
  onOpenUpload: () => void;
}

export function ComparisonView({
  activeDoc,
  comparisons,
  pendingQuestion,
  onClearPendingQuestion,
  onSaveComparison,
  onHydrateDocChunks,
  onOpenUpload,
}: ComparisonViewProps) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(
    comparisons[0]?.id ?? null
  );
  const [expandedChunks, setExpandedChunks] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (pendingQuestion && activeDoc && !busy) {
      setQuestion(pendingQuestion);
      onClearPendingQuestion();
      void executeComparison(pendingQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuestion, activeDoc]);

  useEffect(() => {
    if (!selectedRunId && comparisons[0]) {
      setSelectedRunId(comparisons[0].id);
    }
  }, [comparisons, selectedRunId]);

  if (!activeDoc) {
    return (
      <Surface className="p-8 text-center space-y-4">
        <BookOpen className="w-7 h-7 text-primary mx-auto" />
        <h2 className="text-xl font-editorial font-medium">
          Upload a course document to run RAG vs. Standard AI evaluation
        </h2>
        <Button tone="primary" onClick={onOpenUpload}>
          Upload study material
        </Button>
      </Surface>
    );
  }

  const benchmarkPrompts = activeDoc.title.toLowerCase().includes('attention')
    ? [
        'What specific chunk character length and sliding overlap percentage does CS-402 recommend for project benchmarks?',
        'How does Lecture 11 prove that maximizing cosine similarity equals minimizing squared Euclidean distance for unit vectors?',
      ]
    : [
        'What validation split, Huber δ threshold, and λ_eff formula are required for CS-402 Lab 3, and what is the 80/20 split deduction?',
        'How is σ̂_MAD defined in Lecture 07 and why must it be computed strictly on inner training fold residuals?',
      ];

  async function executeComparison(rawPrompt: string) {
    const cleanPrompt = rawPrompt.trim();
    if (!cleanPrompt || !activeDoc || busy) return;

    setBusy(true);
    setError('');

    try {
      const retrieval = await retrieveSemanticChunks(cleanPrompt, activeDoc.chunks, 4);
      if (retrieval.hydratedChunks) {
        onHydrateDocChunks(activeDoc.id, retrieval.hydratedChunks);
      }

      // Run Grounded RAG and Standard Ungrounded AI in parallel on the exact same question
      const [ragRes, ungroundedRes] = await Promise.all([
        requestTutorChat({
          question: cleanPrompt,
          mode: 'rag',
          chunks: retrieval.topChunks,
          history: [],
        }),
        requestTutorChat({
          question: cleanPrompt,
          mode: 'ungrounded',
        }),
      ]);

      const citedSet = new Set(ragRes.citedPassageIndices);
      const citations =
        citedSet.size > 0
          ? retrieval.citations.filter((_, i) => citedSet.has(i + 1))
          : retrieval.citations.slice(0, 2);

      const peakSim = retrieval.citations[0]?.similarity ?? 0;

      const run: ComparisonRun = {
        id: `comp-${Date.now()}`,
        docId: activeDoc.id,
        docTitle: activeDoc.title,
        question: cleanPrompt,
        createdAt: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
        ragAnswer: ragRes.answer,
        ragGrounded: ragRes.groundedInNotes,
        citations,
        standardAnswer: ungroundedRes.answer,
        peakSimilarity: peakSim,
        vectorEngine: retrieval.vectorEngine,
      };

      onSaveComparison(run);
      setSelectedRunId(run.id);
      setQuestion('');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Comparison evaluation failed. Check your connection and retry.'
      );
    } finally {
      setBusy(false);
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void executeComparison(question);
  };

  const activeRun =
    comparisons.find((c) => c.id === selectedRunId) ?? comparisons[0] ?? null;

  return (
    <div className="space-y-6 min-w-0">
      <div className="space-y-1">
        <h2 className="text-2xl font-editorial font-medium text-foreground">
          RAG vs. Standard AI accuracy evaluation
        </h2>
        <p className="text-sm text-muted max-w-[68ch]">
          Queries the exact same language model side-by-side: once grounded with top cosine-matched
          passages from <span className="text-foreground font-medium">{activeDoc.title}</span>, and
          once without retrieved context to demonstrate how RAG prevents ungrounded guesses on
          course-specific material.
        </p>
      </div>

      {/* Benchmark Prompt Launcher */}
      <Surface className="p-5 space-y-4">
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2.5">
          <label htmlFor="rag-compare-input" className="sr-only">
            Enter a course-specific evaluation question
          </label>
          <input
            id="rag-compare-input"
            type="text"
            disabled={busy}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about a syllabus rubric, professor convention, or specific lecture equation..."
            className="flex-1 min-w-0 min-h-11 rounded-control border border-border bg-background px-3.5 text-sm text-foreground placeholder:text-muted/70 focus-visible:outline-2 focus-visible:outline-primary"
          />
          <Button type="submit" tone="primary" disabled={busy || !question.trim()}>
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Comparing models...</span>
              </>
            ) : (
              <>
                <Scale className="w-4 h-4" />
                <span>Compare side-by-side</span>
              </>
            )}
          </Button>
        </form>

        <div className="pt-3 border-t border-border space-y-2">
          <p className="text-xs text-muted">
            Course-specific benchmark questions (highlights syllabus facts generic LLMs lack):
          </p>
          <div className="flex flex-wrap gap-2">
            {benchmarkPrompts.map((p) => (
              <button
                key={p}
                type="button"
                disabled={busy}
                onClick={() => void executeComparison(p)}
                className="text-left text-xs text-foreground border border-border bg-background hover:border-primary px-3 py-1.5 rounded-control transition-colors"
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p role="alert" className="text-xs text-accent">
            {error}
          </p>
        )}
      </Surface>

      {/* Run Switcher when multiple runs exist */}
      {comparisons.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Saved evaluations:</span>
          {comparisons.slice(0, 6).map((c, idx) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedRunId(c.id)}
              className={`px-2.5 py-1 text-xs rounded-control border whitespace-nowrap transition-colors ${
                activeRun?.id === c.id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-surface text-muted hover:text-foreground'
              }`}
            >
              Run #{comparisons.length - idx} · {c.createdAt}
            </button>
          ))}
        </div>
      )}

      {/* Side-by-Side Comparison Stage */}
      {activeRun && (
        <div className="space-y-4">
          <Surface className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="min-w-0">
              <span className="text-muted mr-2">Evaluated prompt:</span>
              <span className="font-medium text-foreground">{activeRun.question}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-muted shrink-0">
              <span>Peak cos {activeRun.peakSimilarity.toFixed(3)}</span>
              <span>·</span>
              <span>{activeRun.citations.length} cited chunks</span>
            </div>
          </Surface>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            {/* Left Column: Grounded RAG */}
            <Surface className="p-5 sm:p-6 divide-y divide-border">
              <div className="pb-3.5 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-primary font-medium flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-primary inline-block" />
                    AI Study Companion (Grounded RAG)
                  </span>
                  <span className="font-mono text-muted">
                    {activeRun.ragGrounded ? 'Verified in notes' : 'Explicit abstention'}
                  </span>
                </div>
                <p className="text-xs text-muted">
                  Retrieves top chunks from {activeRun.docTitle} before generation.
                </p>
              </div>

              <div className="py-4 text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                {activeRun.ragAnswer}
              </div>

              {activeRun.citations.length > 0 && (
                <div className="pt-3.5 space-y-2.5">
                  <p className="text-xs text-muted">
                    Retrieved course evidence ({activeRun.vectorEngine}):
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {activeRun.citations.map((cit) => {
                      const key = `${activeRun.id}-${cit.chunkId}`;
                      const open = Boolean(expandedChunks[key]);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() =>
                            setExpandedChunks((prev) => ({ ...prev, [key]: !prev[key] }))
                          }
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-control border border-border bg-background hover:border-primary text-xs font-mono whitespace-nowrap"
                        >
                          <span>
                            p. {cit.pageNumber} · #{String(cit.chunkIndex).padStart(2, '0')} · cos{' '}
                            {cit.similarity.toFixed(3)}
                          </span>
                          {open ? (
                            <ChevronUp className="w-3 h-3" />
                          ) : (
                            <ChevronDown className="w-3 h-3" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {activeRun.citations.map((cit) => {
                    const key = `${activeRun.id}-${cit.chunkId}`;
                    if (!expandedChunks[key]) return null;
                    return (
                      <div key={`${key}-txt`} className="pt-2.5 border-t border-border space-y-1">
                        <p className="text-[11px] font-mono text-muted">
                          Page {cit.pageNumber} · Chunk #{cit.chunkIndex}
                        </p>
                        <p className="text-xs font-serif italic text-foreground leading-relaxed">
                          &ldquo;{cit.snippet}&rdquo;
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </Surface>

            {/* Right Column: Standard Ungrounded Chatbot */}
            <Surface className="p-5 sm:p-6 divide-y divide-border">
              <div className="pb-3.5 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-accent font-medium flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-accent inline-block" />
                    Standard AI Chatbot (Ungrounded LLM)
                  </span>
                  <span className="font-mono text-muted">0 chunks · No course context</span>
                </div>
                <p className="text-xs text-muted">
                  Answers solely from general pre-trained weights without syllabus access.
                </p>
              </div>

              <div className="py-4 text-sm text-muted leading-relaxed whitespace-pre-wrap">
                {activeRun.standardAnswer}
              </div>

              <div className="pt-3.5 text-xs text-muted leading-relaxed">
                <span className="text-foreground font-medium">Evaluation takeaway: </span>
                Without vector retrieval over uploaded lecture notes, a standard chatbot either
                provides generic textbook defaults or cannot verify course-specific formulas, page
                citations, and grading protocols.
              </div>
            </Surface>
          </div>
        </div>
      )}
    </div>
  );
}
