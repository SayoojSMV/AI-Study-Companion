import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FileText, Upload, X, Check, Loader2 } from 'lucide-react';
import { generateGeminiEmbeddings } from '../lib/apiClient';
import { extractPagesFromFile, paginatePlainText } from '../lib/pdfParser';
import {
  computeDeterministicEmbedding,
  splitIntoOverlappingChunks,
} from '../model/vectorMath';
import type { DocumentChunk, StudyDocument } from '../types';
import { Button, Field, Surface } from './ui';

interface UploadModalProps {
  open: boolean;
  userId: string;
  onClose: () => void;
  onDocumentIndexed: (doc: StudyDocument) => void;
}

type PipelineStage =
  | 'idle'
  | 'extracting'
  | 'chunking'
  | 'embedding'
  | 'complete';

export function UploadModal({
  open,
  userId,
  onClose,
  onDocumentIndexed,
}: UploadModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<'file' | 'paste'>('file');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [customTitle, setCustomTitle] = useState('');
  const [courseCode, setCourseCode] = useState('CS-402');
  const [pastedNotes, setPastedNotes] = useState('');
  const [stage, setStage] = useState<PipelineStage>('idle');
  const [stageDetail, setStageDetail] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const resetForm = () => {
    setSelectedFile(null);
    setCustomTitle('');
    setPastedNotes('');
    setStage('idle');
    setStageDetail('');
    setError('');
  };

  const handleClose = () => {
    if (stage !== 'idle' && stage !== 'complete') return;
    resetForm();
    onClose();
  };

  const handleProcess = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      setStage('extracting');
      let pages;
      let fileName = 'Pasted_Notes.txt';
      let resolvedTitle = customTitle.trim();

      if (tab === 'file') {
        if (!selectedFile) {
          setStage('idle');
          setError('Choose a PDF, Markdown, or plain-text file to upload.');
          return;
        }
        fileName = selectedFile.name;
        if (!resolvedTitle) {
          resolvedTitle = selectedFile.name.replace(/\.(pdf|txt|md)$/i, '').replace(/[_-]+/g, ' ');
        }
        setStageDetail(`Reading pages from ${selectedFile.name}...`);
        pages = await extractPagesFromFile(selectedFile);
      } else {
        if (pastedNotes.trim().length < 80) {
          setStage('idle');
          setError('Paste at least a paragraph (80+ characters) of lecture notes.');
          return;
        }
        if (!resolvedTitle) {
          resolvedTitle = 'Course Notes · ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
        fileName = `${resolvedTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.txt`;
        setStageDetail('Paginating pasted study material...');
        pages = paginatePlainText(pastedNotes);
      }

      setStage('chunking');
      setStageDetail(
        `Extracted ${pages.length} page${pages.length === 1 ? '' : 's'}. Splitting overlapping semantic chunks...`
      );
      await new Promise((r) => setTimeout(r, 120));

      const rawChunks = splitIntoOverlappingChunks(pages, 660, 125);
      if (rawChunks.length === 0) {
        throw new Error('Could not form semantic text chunks from this document.');
      }

      const docId = `doc-${Date.now().toString(36)}`;
      let geminiVectors: number[][] | null = null;
      let embeddingModel = 'gemini-embedding-2';
      let embeddingDimensions = 256;

      setStage('embedding');
      setStageDetail(
        `Generating vector embeddings for ${rawChunks.length} chunks via Gemini...`
      );

      try {
        const embedRes = await generateGeminiEmbeddings(rawChunks.map((c) => c.text));
        if (embedRes.embeddings.length === rawChunks.length) {
          geminiVectors = embedRes.embeddings;
          embeddingModel = embedRes.model;
          embeddingDimensions = embedRes.dimensions || embedRes.embeddings[0]?.length || 768;
        }
      } catch {
        embeddingModel = 'local-cosine-256d';
        embeddingDimensions = 256;
      }

      const chunks: DocumentChunk[] = rawChunks.map((rc, idx) => ({
        id: `${docId}-chunk-${rc.chunkIndex}`,
        docId,
        docTitle: resolvedTitle,
        pageNumber: rc.pageNumber,
        chunkIndex: rc.chunkIndex,
        sectionHeading: rc.sectionHeading,
        text: rc.text,
        charCount: rc.charCount,
        overlapChars: rc.overlapChars,
        localEmbedding: computeDeterministicEmbedding(rc.text),
        geminiEmbedding: geminiVectors ? geminiVectors[idx] : undefined,
      }));

      const totalChars = pages.reduce((sum, p) => sum + p.text.length, 0);

      const newDoc: StudyDocument = {
        id: docId,
        userId,
        title: resolvedTitle,
        courseCode: courseCode.trim() || 'COURSE',
        fileName,
        uploadedAt: new Date().toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
        pageCount: pages.length,
        totalChars,
        embeddingModel,
        embeddingDimensions,
        chunks,
      };

      setStage('complete');
      setStageDetail(
        `Indexed ${chunks.length} chunks (${embeddingDimensions}d vectors) into your cosine store.`
      );
      onDocumentIndexed(newDoc);
      resetForm();
      onClose();
    } catch (err) {
      setStage('idle');
      setError(err instanceof Error ? err.message : 'Failed to process document.');
    }
  };

  if (!open) return null;

  const isBusy = stage !== 'idle' && stage !== 'complete';

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        handleClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) handleClose();
      }}
      className="m-auto w-full max-w-xl rounded-card border border-border bg-surface p-0 text-foreground shadow-lg backdrop:bg-foreground/30"
    >
      <div className="divide-y divide-border">
        <div className="px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-editorial font-medium">
              Add study material to vector index
            </h2>
            <p className="text-xs text-muted">
              Extracts pages, splits overlapping chunks, and indexes embeddings for cited RAG.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isBusy}
            aria-label="Close upload dialog"
            className="p-1.5 rounded-control text-muted hover:text-foreground hover:bg-background focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleProcess} className="p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setTab('file');
                setError('');
              }}
              disabled={isBusy}
              className={`px-3 py-1.5 text-xs font-medium rounded-control border whitespace-nowrap transition-colors ${
                tab === 'file'
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-surface text-foreground hover:bg-background'
              }`}
            >
              Upload PDF or text file
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('paste');
                setError('');
              }}
              disabled={isBusy}
              className={`px-3 py-1.5 text-xs font-medium rounded-control border whitespace-nowrap transition-colors ${
                tab === 'paste'
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-surface text-foreground hover:bg-background'
              }`}
            >
              Paste lecture notes
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <Field
                label="Document title"
                placeholder="e.g., Lecture 09: Support Vector Machines"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                disabled={isBusy}
              />
            </div>
            <Field
              label="Course code"
              placeholder="CS-402"
              value={courseCode}
              onChange={(e) => setCourseCode(e.target.value)}
              disabled={isBusy}
            />
          </div>

          {tab === 'file' ? (
            <Surface inset className="p-6 text-center">
              <input
                ref={fileInputRef}
                id="study-file-upload"
                type="file"
                accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
                className="sr-only"
                disabled={isBusy}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setSelectedFile(file);
                  if (file && !customTitle) {
                    setCustomTitle(
                      file.name.replace(/\.(pdf|txt|md)$/i, '').replace(/[_-]+/g, ' ')
                    );
                  }
                  setError('');
                }}
              />
              {selectedFile ? (
                <div className="space-y-2">
                  <FileText className="w-6 h-6 text-primary mx-auto" />
                  <p className="text-sm font-medium text-foreground truncate" title={selectedFile.name}>
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-muted font-mono">
                    {(selectedFile.size / 1024).toFixed(1)} KB · Ready for semantic chunking
                  </p>
                  <Button
                    type="button"
                    tone="quiet"
                    disabled={isBusy}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose different file
                  </Button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <Upload className="w-6 h-6 text-muted mx-auto" />
                  <p className="text-sm text-foreground">
                    Select a course PDF, syllabus handout, or plain-text note
                  </p>
                  <p className="text-xs text-muted">
                    Client-side pdf.js extraction · 660-char semantic chunks · 125-char overlap
                  </p>
                  <div className="pt-1">
                    <Button
                      type="button"
                      tone="quiet"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Browse study file
                    </Button>
                  </div>
                </div>
              )}
            </Surface>
          ) : (
            <div className="space-y-1.5">
              <label
                htmlFor="paste-lecture-notes"
                className="block text-sm font-medium text-foreground"
              >
                Lecture text or markdown notes
              </label>
              <textarea
                id="paste-lecture-notes"
                rows={7}
                disabled={isBusy}
                value={pastedNotes}
                onChange={(e) => setPastedNotes(e.target.value)}
                placeholder="Paste definitions, derivations, formulas, or syllabus sections here..."
                className="w-full rounded-control border border-border bg-background p-3.5 text-sm text-foreground placeholder:text-muted/70 focus-visible:outline-2 focus-visible:outline-primary"
              />
            </div>
          )}

          {isBusy && (
            <div
              role="status"
              className="pt-2 border-t border-border space-y-2 text-xs text-muted"
            >
              <div className="flex items-center gap-2 text-foreground font-medium">
                <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                <span>{stageDetail}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px]">
                <span className={stage === 'extracting' ? 'text-primary font-medium' : ''}>
                  1. Extract pages {stage !== 'extracting' && '✓'}
                </span>
                <span>·</span>
                <span className={stage === 'chunking' ? 'text-primary font-medium' : ''}>
                  2. Overlap chunks {stage === 'embedding' ? '✓' : ''}
                </span>
                <span>·</span>
                <span className={stage === 'embedding' ? 'text-primary font-medium' : ''}>
                  3. Vector embeddings
                </span>
              </div>
            </div>
          )}

          {stage === 'complete' && (
            <p role="status" className="text-xs text-primary flex items-center gap-1.5">
              <Check className="w-4 h-4" />
              <span>{stageDetail}</span>
            </p>
          )}

          {error && (
            <p role="alert" className="text-xs text-accent leading-relaxed">
              {error}
            </p>
          )}

          <div className="pt-2 flex flex-wrap items-center justify-end gap-2.5">
            <Button
              type="button"
              tone="quiet"
              onClick={handleClose}
              disabled={isBusy}
            >
              Cancel
            </Button>
            <Button type="submit" tone="primary" disabled={isBusy}>
              {isBusy ? 'Indexing document...' : 'Extract & index material'}
            </Button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
