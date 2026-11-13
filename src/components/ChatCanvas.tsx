import { useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Loader2,
  Scale,
  Send,
  Trash2,
} from 'lucide-react';
import {
  requestTutorChat,
  retrieveSemanticChunks,
} from '../lib/apiClient';
import type {
  ChatMessage,
  DocumentChunk,
  StudyDocument,
  TutorMode,
} from '../types';
import { Button, Surface } from './ui';

interface ChatCanvasProps {
  activeDoc: StudyDocument | null;
  allDocs: StudyDocument[];
  messages: ChatMessage[];
  onAppendMessages: (newMsgs: ChatMessage[]) => void;
  onClearHistory: () => void;
  onHydrateDocChunks: (docId: string, updatedChunks: DocumentChunk[]) => void;
  onOpenUpload: () => void;
  onLaunchComparison: (question: string) => void;
}

export function ChatCanvas({
  activeDoc,
  allDocs,
  messages,
  onAppendMessages,
  onClearHistory,
  onHydrateDocChunks,
  onOpenUpload,
  onLaunchComparison,
}: ChatCanvasProps) {
  const [mode, setMode] = useState<TutorMode>('rag');
  const [scopeAllDocs, setScopeAllDocs] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusNote, setStatusNote] = useState('');
  const [error, setError] = useState('');
  const [expandedCitations, setExpandedCitations] = useState<Record<string, boolean>>({});

  if (!activeDoc) {
    return (
      <Surface className="p-8 text-center space-y-4">
        <BookOpen className="w-7 h-7 text-primary mx-auto" />
        <h2 className="text-xl font-editorial font-medium">
          Upload your first course PDF to begin
        </h2>
        <p className="text-sm text-muted max-w-md mx-auto">
          Add lecture handouts or syllabus notes to build your searchable cosine vector index and
          ask cited questions.
        </p>
        <Button tone="primary" onClick={onOpenUpload}>
          Upload study material
        </Button>
      </Surface>
    );
  }

  const suggestedQuestions = activeDoc.title.toLowerCase().includes('attention')
    ? [
        'Why does self-attention divide QKᵀ by √d_k instead of leaving dot products unscaled?',
        'When does maximizing cosine similarity equal minimizing squared Euclidean distance?',
        'What chunk size and sliding overlap percentage does CS-402 recommend?',
      ]
    : [
        'How does Ridge regression modify the eigenvalues of XᵀX when predictors are collinear?',
        'Under an orthonormal design, when does the Lasso soft-thresholding operator set a weight to zero?',
        'Does Lecture 07 cover LoRA rank-decomposition matrices for LLM fine-tuning?',
      ];

  const toggleCitation = (key: string) => {
    setExpandedCitations((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const submitQuestion = async (rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (!question || busy) return;

    setError('');
    setBusy(true);

    const userMsg: ChatMessage = {
      id: `msg-u-${Date.now()}`,
      role: 'user',
      mode,
      content: question,
      timestamp: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    onAppendMessages([userMsg]);
    setInput('');

    try {
      const candidateDocs = scopeAllDocs ? allDocs : [activeDoc];
      const candidateChunks = candidateDocs.flatMap((d) => d.chunks);

      setStatusNote(
        `Searching ${candidateChunks.length} indexed chunks by cosine similarity...`
      );
      const retrieval = await retrieveSemanticChunks(question, candidateChunks, 4);

      if (retrieval.hydratedChunks && !scopeAllDocs) {
        onHydrateDocChunks(activeDoc.id, retrieval.hydratedChunks);
      }

      setStatusNote(
        mode === 'rag'
          ? 'Synthesizing strictly grounded answer with page citations...'
          : 'Synthesizing conceptual intuition with source provenance...'
      );

      const recentHistory = messages.slice(-6).map((m) => ({
        role: (m.role === 'user' ? 'user' : 'model') as 'user' | 'model',
        text: m.content,
      }));

      const chatRes = await requestTutorChat({
        question,
        mode,
        chunks: retrieval.topChunks,
        history: recentHistory,
      });

      // Map cited 1-based passage indices back to retrieved citations (or show top retrieved if abstaining)
      const citedSet = new Set(chatRes.citedPassageIndices);
      const matchedCitations =
        citedSet.size > 0
          ? retrieval.citations.filter((_, idx) => citedSet.has(idx + 1))
          : chatRes.groundedInNotes
          ? retrieval.citations.slice(0, 2)
          : retrieval.citations.slice(0, 1);

      const assistantMsg: ChatMessage = {
        id: `msg-a-${Date.now()}`,
        role: 'assistant',
        mode,
        content: chatRes.answer,
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
        groundedInNotes: chatRes.groundedInNotes,
        primarySource: chatRes.primarySource,
        provenanceSummary: chatRes.provenanceSummary,
        citations: matchedCitations,
        vectorEngine: retrieval.vectorEngine,
      };

      onAppendMessages([assistantMsg]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to complete doubt-clearing request.'
      );
    } finally {
      setBusy(false);
      setStatusNote('');
    }
  };

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submitQuestion(input);
  };

  return (
    <div className="space-y-6 min-w-0">
      {/* Mode & Retrieval Scope Bar */}
      <Surface className="p-4 sm:px-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <div
            role="group"
            aria-label="Tutor grounding mode"
            className="inline-flex flex-wrap rounded-control border border-border bg-background p-0.5"
          >
            <button
              type="button"
              onClick={() => setMode('rag')}
              className={`px-3 py-1.5 text-xs font-medium rounded-control whitespace-nowrap transition-colors ${
                mode === 'rag'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              Grounded notes (RAG)
            </button>
            <button
              type="button"
              onClick={() => setMode('clarifier')}
              className={`px-3 py-1.5 text-xs font-medium rounded-control whitespace-nowrap transition-colors ${
                mode === 'clarifier'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              Concept clarifier
            </button>
          </div>

          {allDocs.length > 1 && (
            <button
              type="button"
              onClick={() => setScopeAllDocs((s) => !s)}
              className={`px-2.5 py-1.5 text-xs rounded-control border whitespace-nowrap transition-colors ${
                scopeAllDocs
                  ? 'border-primary text-primary bg-background font-medium'
                  : 'border-border text-muted hover:text-foreground bg-surface'
              }`}
            >
              {scopeAllDocs
                ? `Searching all ${allDocs.length} documents`
                : 'Searching active document'}
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>
            {mode === 'rag'
              ? 'Answers strictly restricted to retrieved passages'
              : 'Allows broader intuition · labels Notes vs. General Knowledge'}
          </span>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={onClearHistory}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent whitespace-nowrap focus-visible:outline-2 focus-visible:outline-primary rounded-control px-1.5 py-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear thread</span>
            </button>
          )}
        </div>
      </Surface>

      {/* Notebook Reading & Doubt Thread */}
      {messages.length === 0 ? (
        <Surface className="p-6 sm:p-8 space-y-5">
          <div className="space-y-1.5">
            <h2 className="text-xl font-editorial font-medium">
              Ask a course-grounded question on {activeDoc.title}
            </h2>
            <p className="text-sm text-muted max-w-[62ch]">
              Every question embeds your prompt, retrieves the top matching passages by cosine
              similarity from {activeDoc.chunks.length} overlapping chunks, and attaches verifiable
              page citations.
            </p>
          </div>

          <div className="pt-2 border-t border-border space-y-2.5">
            <p className="text-xs text-muted font-medium">
              Suggested revision prompts for this document:
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestedQuestions.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={busy}
                  onClick={() => void submitQuestion(q)}
                  className="text-left text-xs text-foreground border border-border bg-background hover:border-primary px-3 py-2 rounded-control transition-colors inline-flex items-center gap-2"
                >
                  <span>{q}</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-primary shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </Surface>
      ) : (
        <div className="space-y-4">
          {messages.map((msg, idx) => {
            if (msg.role === 'user') {
              return (
                <div
                  key={msg.id}
                  className="pl-6 sm:pl-14 flex flex-col items-end space-y-1"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>You</span>
                    <span>·</span>
                    <span>
                      {msg.mode === 'rag' ? 'Grounded RAG query' : 'Concept clarifier query'}
                    </span>
                    <span>·</span>
                    <span className="font-mono">{msg.timestamp}</span>
                  </div>
                  <Surface className="px-4 py-3 max-w-2xl bg-surface">
                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                    </p>
                  </Surface>
                  <button
                    type="button"
                    onClick={() => onLaunchComparison(msg.content)}
                    className="inline-flex items-center gap-1 text-xs text-muted hover:text-primary py-0.5 px-1 rounded-control focus-visible:outline-2 focus-visible:outline-primary whitespace-nowrap"
                  >
                    <Scale className="w-3 h-3" />
                    <span>Compare with Standard AI</span>
                  </button>
                </div>
              );
            }

            // Epistemic source provenance header
            const isNotesSource = msg.primarySource === 'uploaded_notes';
            const isNotInNotes = msg.primarySource === 'not_in_notes';
            const prevUserQuestion =
              idx > 0 && messages[idx - 1]?.role === 'user'
                ? messages[idx - 1].content
                : null;

            return (
              <Surface
                key={msg.id}
                className="p-5 sm:p-6 divide-y divide-border max-w-4xl"
              >
                {/* Provenance metadata line (quiet text joined by middle dots per Rule 3) */}
                <div className="pb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`inline-block w-2 h-2 rounded-full ${
                        isNotesSource
                          ? 'bg-primary'
                          : isNotInNotes
                          ? 'bg-accent'
                          : 'bg-accent'
                      }`}
                    />
                    <span
                      className={`font-medium ${
                        isNotesSource ? 'text-primary' : 'text-accent'
                      }`}
                    >
                      {isNotesSource
                        ? 'Source: Uploaded Notes'
                        : isNotInNotes
                        ? 'Not in Uploaded Notes · Grounded Abstention'
                        : 'Source: General Knowledge · Concept Clarifier'}
                    </span>
                    <span>·</span>
                    <span>
                      {msg.mode === 'rag' ? 'Strict RAG' : 'Concept Clarifier'}
                    </span>
                    <span>·</span>
                    <span className="font-mono">{msg.timestamp}</span>
                  </div>

                  {prevUserQuestion && (
                    <button
                      type="button"
                      onClick={() => onLaunchComparison(prevUserQuestion)}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline whitespace-nowrap focus-visible:outline-2 focus-visible:outline-primary rounded-control"
                    >
                      <Scale className="w-3.5 h-3.5" />
                      <span>Compare with Standard AI</span>
                    </button>
                  )}
                </div>

                {/* Answer Body */}
                <div className="py-4 space-y-3">
                  {msg.provenanceSummary && (
                    <p className="text-xs text-muted italic">
                      {msg.provenanceSummary}
                    </p>
                  )}
                  <div className="text-[15px] text-foreground leading-relaxed whitespace-pre-wrap max-w-[70ch]">
                    {msg.content}
                  </div>
                </div>

                {/* Expandable Verbatim Page & Chunk Citations */}
                {msg.citations && msg.citations.length > 0 && (
                  <div className="pt-3.5 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                      <span>
                        Retrieved evidence ({msg.citations.length}{' '}
                        {msg.citations.length === 1 ? 'passage' : 'passages'}) · click to inspect
                        source chunk
                      </span>
                      {msg.vectorEngine && (
                        <span className="font-mono text-[11px]">
                          {msg.vectorEngine}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {msg.citations.map((cit) => {
                        const citKey = `${msg.id}-${cit.chunkId}`;
                        const isOpen = Boolean(expandedCitations[citKey]);
                        return (
                          <button
                            key={citKey}
                            type="button"
                            aria-expanded={isOpen}
                            onClick={() => toggleCitation(citKey)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-control border text-xs font-mono whitespace-nowrap transition-colors ${
                              isOpen
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border bg-background text-foreground hover:border-primary'
                            }`}
                          >
                            <span>
                              p. {cit.pageNumber} · chunk #{String(cit.chunkIndex).padStart(2, '0')} · cos{' '}
                              {cit.similarity.toFixed(3)}
                            </span>
                            {isOpen ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {msg.citations.map((cit) => {
                      const citKey = `${msg.id}-${cit.chunkId}`;
                      if (!expandedCitations[citKey]) return null;
                      return (
                        <div
                          key={`${citKey}-panel`}
                          className="pt-3 border-t border-border space-y-1.5"
                        >
                          <p className="text-xs text-muted font-mono">
                            {cit.docTitle} · Page {cit.pageNumber} · Chunk #{cit.chunkIndex}
                            {cit.sectionHeading ? ` · ${cit.sectionHeading}` : ''} · Cosine
                            similarity {cit.similarity.toFixed(4)}
                          </p>
                          <p className="text-xs text-foreground leading-relaxed font-serif italic max-w-[75ch]">
                            &ldquo;{cit.snippet}&rdquo;
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Surface>
            );
          })}
        </div>
      )}

      {/* Quick Follow-Up Suggestions when messages exist */}
      {messages.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Try asking:</span>
          {suggestedQuestions.map((q) => (
            <button
              key={q}
              type="button"
              disabled={busy}
              onClick={() => void submitQuestion(q)}
              className="text-xs text-muted hover:text-foreground border border-border bg-surface px-2.5 py-1 rounded-control transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Composer */}
      <Surface className="p-3.5 sm:p-4 space-y-3">
        {busy && statusNote && (
          <div
            role="status"
            className="flex items-center gap-2 text-xs text-primary font-medium"
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span>{statusNote}</span>
          </div>
        )}

        {error && (
          <p role="alert" className="text-xs text-accent">
            {error}
          </p>
        )}

        <form onSubmit={handleFormSubmit} className="flex flex-col sm:flex-row gap-2.5">
          <label htmlFor="doubt-chat-input" className="sr-only">
            Ask a question about your uploaded study materials
          </label>
          <input
            id="doubt-chat-input"
            type="text"
            disabled={busy}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              mode === 'rag'
                ? `Ask a grounded question on "${activeDoc.title}"...`
                : 'Ask for broader conceptual intuition or background analogies...'
            }
            className="flex-1 min-w-0 min-h-11 rounded-control border border-border bg-background px-3.5 text-sm text-foreground placeholder:text-muted/70 focus-visible:outline-2 focus-visible:outline-primary"
          />
          <Button
            type="submit"
            tone={mode === 'rag' ? 'primary' : 'accent'}
            disabled={busy || !input.trim()}
          >
            <Send className="w-4 h-4" />
            <span>{mode === 'rag' ? 'Ask notes' : 'Clarify concept'}</span>
          </Button>
        </form>
      </Surface>
    </div>
  );
}
