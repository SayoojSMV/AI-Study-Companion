import { useState } from 'react';
import {
  BookOpen,
  Check,
  Loader2,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';
import { requestPracticeQuiz } from '../lib/apiClient';
import type { SavedQuiz, StudyDocument } from '../types';
import { Button, Surface } from './ui';

interface QuizViewProps {
  activeDoc: StudyDocument | null;
  quiz?: SavedQuiz;
  onSaveQuiz: (quiz: SavedQuiz) => void;
  onOpenUpload: () => void;
}

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

export function QuizView({
  activeDoc,
  quiz,
  onSaveQuiz,
  onOpenUpload,
}: QuizViewProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [missedOnlyIndices, setMissedOnlyIndices] = useState<number[] | null>(null);

  if (!activeDoc) {
    return (
      <Surface className="p-8 text-center space-y-4">
        <BookOpen className="w-7 h-7 text-primary mx-auto" />
        <h2 className="text-xl font-editorial font-medium">
          No document selected for practice quiz
        </h2>
        <Button tone="primary" onClick={onOpenUpload}>
          Upload study material
        </Button>
      </Surface>
    );
  }

  const handleGenerateQuiz = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    setMissedOnlyIndices(null);

    try {
      const questions = await requestPracticeQuiz(
        activeDoc.title,
        activeDoc.chunks,
        Date.now()
      );
      if (!questions.length) {
        throw new Error('Model returned an empty question set. Please retry.');
      }

      const nextQuiz: SavedQuiz = {
        id: `quiz-${Date.now()}`,
        docId: activeDoc.id,
        docTitle: activeDoc.title,
        createdAt: new Date().toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
        questions,
        selectedAnswers: {},
        bestScore: quiz?.bestScore,
      };
      onSaveQuiz(nextQuiz);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to generate practice quiz.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSelectOption = (qIdx: number, optIdx: number) => {
    if (!quiz) return;
    if (quiz.selectedAnswers[qIdx] !== undefined) return; // Lock once answered for immediate honest grading

    const nextAnswers = { ...quiz.selectedAnswers, [qIdx]: optIdx };
    const totalQuestions = quiz.questions.length;
    const answeredCount = Object.keys(nextAnswers).length;

    let correctCount = 0;
    quiz.questions.forEach((q, idx) => {
      if (nextAnswers[idx] === q.correctIndex) correctCount++;
    });

    const pct = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
    const nextBest =
      answeredCount === totalQuestions
        ? Math.max(quiz.bestScore ?? 0, pct)
        : quiz.bestScore;

    onSaveQuiz({
      ...quiz,
      selectedAnswers: nextAnswers,
      bestScore: nextBest,
    });
  };

  const handleResetAttempt = () => {
    if (!quiz) return;
    setMissedOnlyIndices(null);
    onSaveQuiz({
      ...quiz,
      selectedAnswers: {},
    });
  };

  const handleRetryMissed = () => {
    if (!quiz) return;
    const missed: number[] = [];
    const cleanedAnswers = { ...quiz.selectedAnswers };

    quiz.questions.forEach((q, idx) => {
      if (quiz.selectedAnswers[idx] !== undefined && quiz.selectedAnswers[idx] !== q.correctIndex) {
        missed.push(idx);
        delete cleanedAnswers[idx];
      }
    });

    if (missed.length > 0) {
      setMissedOnlyIndices(missed);
      onSaveQuiz({
        ...quiz,
        selectedAnswers: cleanedAnswers,
      });
    }
  };

  const answeredKeys = quiz ? Object.keys(quiz.selectedAnswers) : [];
  const totalCount = quiz?.questions.length ?? 0;
  const correctCount = quiz
    ? quiz.questions.reduce(
        (acc, q, idx) => acc + (quiz.selectedAnswers[idx] === q.correctIndex ? 1 : 0),
        0
      )
    : 0;
  const missedCount = quiz
    ? quiz.questions.reduce(
        (acc, q, idx) =>
          acc +
          (quiz.selectedAnswers[idx] !== undefined &&
          quiz.selectedAnswers[idx] !== q.correctIndex
            ? 1
            : 0),
        0
      )
    : 0;

  const visibleIndices = quiz
    ? missedOnlyIndices ?? quiz.questions.map((_, i) => i)
    : [];

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <h2 className="text-2xl font-editorial font-medium text-foreground">
            Course-grounded practice quiz
          </h2>
          <p className="text-xs text-muted">
            5 multiple-choice questions generated strictly from{' '}
            <span className="text-foreground font-medium">{activeDoc.title}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {quiz && answeredKeys.length > 0 && (
            <Button tone="quiet" onClick={handleResetAttempt} disabled={busy}>
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset answers</span>
            </Button>
          )}
          <Button
            tone={quiz ? 'quiet' : 'primary'}
            onClick={handleGenerateQuiz}
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Drafting 5 questions...</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                <span>{quiz ? 'New 5-question quiz' : 'Generate 5-question quiz'}</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs text-accent">
          {error}
        </p>
      )}

      {!quiz ? (
        <Surface className="p-8 space-y-4">
          <h3 className="text-lg font-editorial font-medium">
            Test comprehension on {activeDoc.title}
          </h3>
          <p className="text-sm text-muted max-w-[60ch] leading-relaxed">
            Generates 5 multiple-choice questions strictly from your uploaded passages, with
            clickable options, instant grading, and grounded answer rationales.
          </p>
          <Button tone="primary" onClick={handleGenerateQuiz} disabled={busy}>
            {busy ? 'Generating quiz...' : 'Generate 5-question quiz'}
          </Button>
        </Surface>
      ) : (
        <div className="space-y-5 max-w-4xl">
          {/* Score Readout Strip (single border level, hairline parted) */}
          <Surface className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2.5 text-muted">
              <span className="text-foreground font-medium tabular-nums">
                Score: {correctCount} / {totalCount} correct
                {answeredKeys.length > 0
                  ? ` (${Math.round((correctCount / totalCount) * 100)}%)`
                  : ''}
              </span>
              <span>·</span>
              <span className="tabular-nums">
                Answered {answeredKeys.length} of {totalCount}
              </span>
              {quiz.bestScore !== undefined && (
                <>
                  <span>·</span>
                  <span className="font-mono text-primary">
                    Best {quiz.bestScore}%
                  </span>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {missedOnlyIndices !== null && (
                <button
                  type="button"
                  onClick={() => setMissedOnlyIndices(null)}
                  className="text-xs text-primary hover:underline whitespace-nowrap"
                >
                  Show all 5 questions
                </button>
              )}
              {missedCount > 0 && missedOnlyIndices === null && (
                <button
                  type="button"
                  onClick={handleRetryMissed}
                  className="text-xs font-medium text-accent hover:underline whitespace-nowrap"
                >
                  Retry {missedCount} missed {missedCount === 1 ? 'item' : 'items'}
                </button>
              )}
            </div>
          </Surface>

          {/* Questions List */}
          <div className="space-y-4">
            {visibleIndices.map((qIdx) => {
              const q = quiz.questions[qIdx];
              if (!q) return null;
              const selected = quiz.selectedAnswers[qIdx];
              const isAnswered = selected !== undefined;
              const isCorrect = isAnswered && selected === q.correctIndex;

              return (
                <Surface
                  key={`${quiz.id}-q-${qIdx}`}
                  className="p-5 sm:p-6 divide-y divide-border"
                >
                  <div className="pb-4 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                      <span>
                        Question {qIdx + 1} of {totalCount} · {q.topic}
                      </span>
                      <span className="font-mono">{q.pageRef}</span>
                    </div>
                    <h3 className="text-base sm:text-lg font-editorial font-medium leading-snug text-foreground">
                      {q.question}
                    </h3>
                  </div>

                  <div className="py-4 space-y-2">
                    {q.options.map((opt, optIdx) => {
                      const isThisSelected = selected === optIdx;
                      const isThisRight = optIdx === q.correctIndex;

                      let stateClasses =
                        'border-border bg-surface text-foreground hover:bg-background hover:border-foreground/30';

                      if (isAnswered) {
                        if (isThisRight) {
                          stateClasses =
                            'border-primary bg-primary/8 text-foreground font-medium';
                        } else if (isThisSelected && !isThisRight) {
                          stateClasses =
                            'border-accent bg-accent/8 text-foreground';
                        } else {
                          stateClasses =
                            'border-border bg-surface text-muted opacity-75';
                        }
                      }

                      return (
                        <button
                          key={optIdx}
                          type="button"
                          disabled={isAnswered}
                          onClick={() => handleSelectOption(qIdx, optIdx)}
                          className={`w-full text-left rounded-control border px-3.5 py-2.5 text-sm transition-colors flex items-start justify-between gap-3 focus-visible:outline-2 focus-visible:outline-primary ${stateClasses}`}
                        >
                          <span className="min-w-0 leading-relaxed">
                            <span className="font-mono text-xs text-muted mr-2.5">
                              {OPTION_LABELS[optIdx] || optIdx + 1}.
                            </span>
                            {opt}
                          </span>
                          {isAnswered && isThisRight && (
                            <Check
                              aria-label="Correct option"
                              className="w-4 h-4 text-primary shrink-0 mt-0.5"
                            />
                          )}
                          {isAnswered && isThisSelected && !isThisRight && (
                            <X
                              aria-label="Incorrect selection"
                              className="w-4 h-4 text-accent shrink-0 mt-0.5"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {isAnswered && (
                    <div className="pt-3.5 space-y-1 text-xs leading-relaxed">
                      <p
                        className={`font-medium ${
                          isCorrect ? 'text-primary' : 'text-accent'
                        }`}
                      >
                        {isCorrect
                          ? 'Correct · Grounded in course notes'
                          : `Incorrect · Correct answer is ${OPTION_LABELS[q.correctIndex]}`}
                        <span className="text-muted font-mono font-normal ml-2">
                          ({q.pageRef})
                        </span>
                      </p>
                      <p className="text-muted max-w-[70ch]">{q.explanation}</p>
                    </div>
                  )}
                </Surface>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
