import { useState } from 'react';
import { BookOpen, Loader2, RefreshCw } from 'lucide-react';
import { requestRevisionSummary } from '../lib/apiClient';
import type { RevisionSummary, StudyDocument } from '../types';
import { Button, Surface } from './ui';

interface SummaryViewProps {
  activeDoc: StudyDocument | null;
  summary?: RevisionSummary;
  onSaveSummary: (summary: RevisionSummary) => void;
  onOpenUpload: () => void;
}

export function SummaryView({
  activeDoc,
  summary,
  onSaveSummary,
  onOpenUpload,
}: SummaryViewProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!activeDoc) {
    return (
      <Surface className="p-8 text-center space-y-4">
        <BookOpen className="w-7 h-7 text-primary mx-auto" />
        <h2 className="text-xl font-editorial font-medium">
          No document selected for summarization
        </h2>
        <Button tone="primary" onClick={onOpenUpload}>
          Upload study material
        </Button>
      </Surface>
    );
  }

  const handleGenerate = async () => {
    if (busy) return;
    setBusy(true);
    setError('');

    try {
      const generated = await requestRevisionSummary(activeDoc.title, activeDoc.chunks);
      const record: RevisionSummary = {
        id: `sum-${Date.now()}`,
        docId: activeDoc.id,
        docTitle: activeDoc.title,
        createdAt: new Date().toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
        overview: generated.overview,
        keyPoints: generated.keyPoints ?? [],
        formulas: generated.formulas ?? [],
        definitions: generated.definitions ?? [],
      };
      onSaveSummary(record);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not generate revision summary.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <h2 className="text-2xl font-editorial font-medium text-foreground">
            Structured revision summary
          </h2>
          <p className="text-xs text-muted">
            Synthesized strictly from {activeDoc.chunks.length} indexed chunks of{' '}
            <span className="text-foreground font-medium">{activeDoc.fileName}</span>
          </p>
        </div>

        <Button
          tone={summary ? 'quiet' : 'primary'}
          onClick={handleGenerate}
          disabled={busy}
        >
          {busy ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Synthesizing notes...</span>
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4" />
              <span>{summary ? 'Regenerate summary' : 'Generate revision summary'}</span>
            </>
          )}
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-xs text-accent">
          {error}
        </p>
      )}

      {!summary ? (
        <Surface className="p-8 space-y-4">
          <h3 className="text-lg font-editorial font-medium">
            Ready to compile revision notes for {activeDoc.title}
          </h3>
          <p className="text-sm text-muted max-w-[60ch] leading-relaxed">
            Generate a concise academic study sheet extracting core takeaways, mathematical
            equations, and glossary definitions with exact page references from your uploaded
            document.
          </p>
          <Button tone="primary" onClick={handleGenerate} disabled={busy}>
            {busy ? 'Generating revision sheet...' : 'Generate revision summary'}
          </Button>
        </Surface>
      ) : (
        <Surface className="p-6 sm:p-8 divide-y divide-border max-w-4xl">
          {/* Overview */}
          <section className="pb-6 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span>Executive synthesis · {activeDoc.courseCode}</span>
              <span className="font-mono">Saved {summary.createdAt}</span>
            </div>
            <p className="text-base sm:text-lg font-editorial leading-relaxed text-foreground max-w-[68ch]">
              {summary.overview}
            </p>
          </section>

          {/* Key Bullet Points */}
          <section className="py-6 space-y-3.5">
            <h3 className="text-lg font-editorial font-medium">
              Key takeaways &amp; principles
            </h3>
            <ul className="divide-y divide-border/70">
              {summary.keyPoints.map((item, idx) => (
                <li
                  key={idx}
                  className="py-2.5 first:pt-0 last:pb-0 flex items-baseline justify-between gap-4"
                >
                  <span className="text-sm text-foreground leading-relaxed max-w-[66ch]">
                    • {item.point}
                  </span>
                  <span className="text-xs font-mono text-muted shrink-0">
                    {item.pageRef}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Formulas & Mathematical Relations */}
          {summary.formulas.length > 0 && (
            <section className="py-6 space-y-3.5">
              <h3 className="text-lg font-editorial font-medium">
                Formulas &amp; core relations
              </h3>
              <div className="divide-y divide-border/70">
                {summary.formulas.map((f, idx) => (
                  <div key={idx} className="py-3.5 first:pt-0 last:pb-0 space-y-1.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {f.name}
                      </span>
                      <span className="text-xs font-mono text-muted">
                        {f.pageRef}
                      </span>
                    </div>
                    <p className="text-base font-editorial italic text-primary tracking-wide py-0.5">
                      {f.expression}
                    </p>
                    <p className="text-xs text-muted leading-relaxed max-w-[68ch]">
                      {f.meaning}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Definitions Glossary */}
          {summary.definitions.length > 0 && (
            <section className="pt-6 space-y-3.5">
              <h3 className="text-lg font-editorial font-medium">
                Course definitions &amp; terminology
              </h3>
              <dl className="divide-y divide-border/70">
                {summary.definitions.map((d, idx) => (
                  <div
                    key={idx}
                    className="py-3 first:pt-0 last:pb-0 grid grid-cols-1 sm:grid-cols-12 gap-1 sm:gap-4 items-baseline"
                  >
                    <dt className="sm:col-span-4 text-sm font-medium text-foreground">
                      {d.term}
                    </dt>
                    <dd className="sm:col-span-7 text-sm text-muted leading-relaxed">
                      {d.definition}
                    </dd>
                    <dd className="sm:col-span-1 text-xs font-mono text-muted sm:text-right">
                      {d.pageRef}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </Surface>
      )}
    </div>
  );
}
