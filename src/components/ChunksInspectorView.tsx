import { useMemo, useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import {
  computeDeterministicEmbedding,
  cosineSimilarity,
} from '../model/vectorMath';
import type { StudyDocument } from '../types';
import { Button, Surface } from './ui';

interface ChunksInspectorViewProps {
  activeDoc: StudyDocument | null;
  onOpenUpload: () => void;
}

export function ChunksInspectorView({
  activeDoc,
  onOpenUpload,
}: ChunksInspectorViewProps) {
  const [probeQuery, setProbeQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const rankedChunks = useMemo(() => {
    if (!activeDoc) return [];
    const q = probeQuery.trim();
    if (!q) {
      return activeDoc.chunks.map((c) => ({ chunk: c, score: null as number | null }));
    }
    const qVec = computeDeterministicEmbedding(q);
    return activeDoc.chunks
      .map((c) => ({
        chunk: c,
        score: cosineSimilarity(qVec, c.localEmbedding),
      }))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }, [activeDoc, probeQuery]);

  if (!activeDoc) {
    return (
      <Surface className="p-8 text-center space-y-4">
        <BookOpen className="w-7 h-7 text-primary mx-auto" />
        <h2 className="text-xl font-editorial font-medium">
          No indexed document to inspect
        </h2>
        <Button tone="primary" onClick={onOpenUpload}>
          Upload study material
        </Button>
      </Surface>
    );
  }

  const displayed = showAll ? rankedChunks : rankedChunks.slice(0, 6);

  return (
    <div className="space-y-6 min-w-0 max-w-4xl">
      <div className="space-y-1">
        <h2 className="text-2xl font-editorial font-medium text-foreground">
          Document chunks &amp; vector index inspector
        </h2>
        <p className="text-xs text-muted">
          Inspect how <span className="text-foreground font-medium">{activeDoc.fileName}</span> is
          segmented into overlapping semantic passages and ranked by cosine similarity.
        </p>
      </div>

      {/* Pipeline Telemetry Strip (parted by hairline rules, no nested boxes) */}
      <Surface className="px-5 py-4 divide-y divide-border">
        <div className="pb-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2.5 text-muted">
            <span>
              Pages: <strong className="text-foreground tabular-nums">{activeDoc.pageCount}</strong>
            </span>
            <span>·</span>
            <span>
              Indexed chunks:{' '}
              <strong className="text-foreground tabular-nums">{activeDoc.chunks.length}</strong>
            </span>
            <span>·</span>
            <span>
              Total characters:{' '}
              <strong className="text-foreground tabular-nums">
                {activeDoc.totalChars.toLocaleString()}
              </strong>
            </span>
            <span>·</span>
            <span className="font-mono text-primary">
              {activeDoc.chunks.some((c) => c.geminiEmbedding?.length)
                ? `gemini-embedding-2 (${activeDoc.chunks[0]?.geminiEmbedding?.length}d)`
                : `${activeDoc.embeddingModel} (${activeDoc.embeddingDimensions}d)`}
            </span>
          </div>
          <span className="font-mono text-muted">Target 660c · Overlap 125c</span>
        </div>

        <div className="pt-3 flex items-center gap-2.5">
          <Search className="w-4 h-4 text-muted shrink-0" />
          <label htmlFor="chunk-probe-input" className="sr-only">
            Probe cosine similarity across chunks
          </label>
          <input
            id="chunk-probe-input"
            type="text"
            value={probeQuery}
            onChange={(e) => setProbeQuery(e.target.value)}
            placeholder="Type keywords or a concept (e.g., Huber threshold, eigenvalues, softmax) to rank chunks live..."
            className="w-full min-h-9 text-sm bg-transparent text-foreground placeholder:text-muted/70 focus:outline-none"
          />
          {probeQuery && (
            <button
              type="button"
              onClick={() => setProbeQuery('')}
              className="text-xs text-muted hover:text-foreground whitespace-nowrap"
            >
              Reset
            </button>
          )}
        </div>
      </Surface>

      {/* Chunk Cards */}
      <div className="space-y-3">
        {displayed.map(({ chunk, score }) => (
          <Surface key={chunk.id} className="p-5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs border-b border-border pb-2.5">
              <div className="flex flex-wrap items-center gap-2 font-mono text-muted">
                <span className="text-foreground font-medium">
                  Chunk #{String(chunk.chunkIndex).padStart(2, '0')}
                </span>
                <span>·</span>
                <span>Page {chunk.pageNumber}</span>
                <span>·</span>
                <span>{chunk.charCount} chars</span>
                {chunk.overlapChars > 0 && (
                  <>
                    <span>·</span>
                    <span>{chunk.overlapChars}c overlap</span>
                  </>
                )}
              </div>

              {score !== null ? (
                <span className="font-mono text-xs text-primary font-medium">
                  cos {score.toFixed(4)}
                </span>
              ) : chunk.sectionHeading ? (
                <span className="text-xs text-muted truncate max-w-xs" title={chunk.sectionHeading}>
                  {chunk.sectionHeading}
                </span>
              ) : null}
            </div>

            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
              {chunk.text}
            </p>
          </Surface>
        ))}

        {rankedChunks.length > 6 && (
          <div className="pt-1">
            <Button
              tone="quiet"
              onClick={() => setShowAll((s) => !s)}
            >
              {showAll
                ? 'Show top 6 chunks'
                : `Show all ${rankedChunks.length} indexed chunks`}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
