import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Circle,
  FileText,
  ListChecks,
  Lock,
  MessageSquareText,
  Plus,
} from 'lucide-react';
import { getLocalDateKey } from '../data/seedWorkspace';
import type {
  StudentUser,
  StudentWorkspaceData,
  WorkspaceTab,
} from '../types';
import { Button, Surface } from './ui';

interface StudyDashboardProps {
  user: StudentUser;
  workspace: StudentWorkspaceData;
  onToggleTopicComplete: (docId: string) => void;
  onChangeDailyGoal: (minutes: number) => void;
  onOpenDocumentTool: (docId: string, tab: WorkspaceTab) => void;
  onOpenUpload: () => void;
}

const SCHOLARLY_THOUGHTS = [
  {
    quote:
      'What I cannot create, I do not understand. Break every derivation down until its assumptions are unmistakable.',
    author: 'Richard P. Feynman',
    context: 'Foundations & First Principles',
  },
  {
    quote:
      'Nothing in life is to be feared, it is only to be understood. Now is the time to understand more, so that we may fear less.',
    author: 'Marie Skłodowska Curie',
    context: 'Scientific Inquiry',
  },
  {
    quote:
      'The Analytical Engine has no pretensions to originate anything. It can do whatever we know how to order it to perform.',
    author: 'Ada Lovelace',
    context: 'Computation & Verification',
  },
  {
    quote:
      'Simplicity is prerequisite for reliability. Verify every boundary case before trusting the abstraction.',
    author: 'Edsger W. Dijkstra',
    context: 'Algorithmic Discipline',
  },
  {
    quote:
      'Somewhere, something incredible is waiting to be known—provided we ask disciplined questions of the evidence.',
    author: 'Carl Sagan',
    context: 'Empirical Reasoning',
  },
  {
    quote:
      'We are what we repeatedly do. Mastery in technical study, then, is not an act, but a daily habit.',
    author: 'Aristotle',
    context: 'Academic Consistency',
  },
  {
    quote:
      'An approximate answer to the right question is worth far more than an exact answer to the wrong one.',
    author: 'John W. Tukey',
    context: 'Statistical Thinking',
  },
];

function formatDuration(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function getThoughtOfTheDay() {
  const now = new Date();
  const dayIndex =
    (now.getFullYear() * 366 + (now.getMonth() + 1) * 31 + now.getDate()) %
    SCHOLARLY_THOUGHTS.length;
  return SCHOLARLY_THOUGHTS[Math.abs(dayIndex)];
}

export function StudyDashboard({
  user,
  workspace,
  onToggleTopicComplete,
  onChangeDailyGoal,
  onOpenDocumentTool,
  onOpenUpload,
}: StudyDashboardProps) {
  const [hoveredDayKey, setHoveredDayKey] = useState<string | null>(null);

  const thought = useMemo(() => getThoughtOfTheDay(), []);
  const metrics = workspace.studyMetrics;
  const todayKey = getLocalDateKey(0);
  const todayMinutes = metrics.dailyMinutes[todayKey] ?? 0;

  // Build last 7 local calendar days chronologically
  const weekSeries = useMemo(() => {
    const days: Array<{ key: string; shortDay: string; dateLabel: string; minutes: number }> = [];
    for (let offset = -6; offset <= 0; offset++) {
      const now = new Date();
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      const key = getLocalDateKey(offset);
      days.push({
        key,
        shortDay: d.toLocaleDateString('en-US', { weekday: 'short' }),
        dateLabel: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        minutes: metrics.dailyMinutes[key] ?? 0,
      });
    }
    return days;
  }, [metrics.dailyMinutes]);

  const weeklyTotalMinutes = weekSeries.reduce((sum, d) => sum + d.minutes, 0);
  const goalMetDays = weekSeries.filter((d) => d.minutes >= metrics.dailyGoalMinutes).length;

  const totalTopics = workspace.documents.length;
  const completedTopics = workspace.documents.filter((d) =>
    metrics.completedDocIds.includes(d.id)
  ).length;

  // Compute real quiz mastery & grounding mode counts from workspace data
  const quizScores = Object.values(workspace.quizzesByDoc)
    .map((q) => {
      if (typeof q.bestScore === 'number') return q.bestScore;
      const answered = Object.keys(q.selectedAnswers).length;
      if (answered === 0 || q.questions.length === 0) return null;
      let correct = 0;
      q.questions.forEach((item, idx) => {
        if (q.selectedAnswers[idx] === item.correctIndex) correct++;
      });
      return Math.round((correct / q.questions.length) * 100);
    })
    .filter((v): v is number => v !== null);

  const avgQuizMastery =
    quizScores.length > 0
      ? Math.round(quizScores.reduce((a, b) => a + b, 0) / quizScores.length)
      : null;

  const modeCounts = useMemo(() => {
    let rag = 0;
    let clarifier = 0;
    for (const msgs of Object.values(workspace.messagesByDoc)) {
      for (const m of msgs) {
        if (m.role === 'user') {
          if (m.mode === 'rag') rag++;
          else clarifier++;
        }
      }
    }
    const comparisons = workspace.comparisons.length;
    const total = rag + clarifier + comparisons;
    return { rag, clarifier, comparisons, total };
  }, [workspace.messagesByDoc, workspace.comparisons.length]);

  // Bar Chart Geometry (pure data-driven coordinates)
  const chartW = 540;
  const chartH = 210;
  const padLeft = 42;
  const padRight = 18;
  const padTop = 20;
  const padBottom = 34;
  const plotW = chartW - padLeft - padRight;
  const plotH = chartH - padTop - padBottom;

  const maxMinutes = Math.max(
    metrics.dailyGoalMinutes + 10,
    ...weekSeries.map((d) => d.minutes),
    60
  );
  const yTickStep = maxMinutes <= 60 ? 20 : maxMinutes <= 120 ? 30 : 45;
  const yCeiling = Math.ceil(maxMinutes / yTickStep) * yTickStep;
  const yTicks: number[] = [];
  for (let v = 0; v <= yCeiling; v += yTickStep) {
    yTicks.push(v);
  }

  const slotW = plotW / weekSeries.length;
  const barW = Math.min(38, slotW * 0.56);
  const goalY = padTop + plotH - (metrics.dailyGoalMinutes / yCeiling) * plotH;

  const activeDay =
    weekSeries.find((d) => d.key === hoveredDayKey) ?? weekSeries[weekSeries.length - 1];

  const todayFormatted = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="space-y-6 min-w-0">
      {/* Personal Greeting & Thought of the Day */}
      <Surface className="p-5 sm:p-6 divide-y divide-border">
        <div className="pb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <p className="text-xs text-muted">
              {todayFormatted} · {user.program}
            </p>
            <h2 className="text-2xl font-editorial font-medium text-foreground">
              {user.name}&apos;s study desk
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Lock className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>
              {user.isDemo
                ? 'Local session · Sign in with Google for private cloud sync'
                : `Private to ${user.email}`}
            </span>
          </div>
        </div>

        <div className="pt-4 space-y-1.5">
          <p className="text-xs font-medium text-primary">
            Thought of the day · {thought.context}
          </p>
          <blockquote className="text-base sm:text-lg font-editorial italic text-foreground leading-relaxed max-w-[68ch]">
            &ldquo;{thought.quote}&rdquo;
          </blockquote>
          <p className="text-xs text-muted">— {thought.author}</p>
        </div>
      </Surface>

      {/* Single-Elevation Ruled Study Readouts */}
      <Surface className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border">
        <div className="p-4 sm:p-5 space-y-1 min-w-0">
          <p className="text-xs text-muted">Time spent today</p>
          <p className="text-2xl font-editorial font-medium text-foreground tabular-nums">
            {formatDuration(todayMinutes)}
          </p>
          <p className="text-xs text-muted tabular-nums">
            {Math.min(100, Math.round((todayMinutes / metrics.dailyGoalMinutes) * 100))}% of{' '}
            {metrics.dailyGoalMinutes}m daily goal
          </p>
        </div>

        <div className="p-4 sm:p-5 space-y-1 min-w-0">
          <p className="text-xs text-muted">7-day study total</p>
          <p className="text-2xl font-editorial font-medium text-foreground tabular-nums">
            {formatDuration(weeklyTotalMinutes)}
          </p>
          <p className="text-xs text-muted tabular-nums">
            {goalMetDays} of 7 days met target
          </p>
        </div>

        <div className="p-4 sm:p-5 space-y-1 min-w-0">
          <p className="text-xs text-muted">Topics completed</p>
          <p className="text-2xl font-editorial font-medium text-foreground tabular-nums">
            {completedTopics} / {totalTopics}
          </p>
          <p className="text-xs text-muted tabular-nums">
            {Object.keys(workspace.summariesByDoc).length} revision sheets saved
          </p>
        </div>

        <div className="p-4 sm:p-5 space-y-1 min-w-0">
          <p className="text-xs text-muted">Average quiz score</p>
          <p className="text-2xl font-editorial font-medium text-foreground tabular-nums">
            {avgQuizMastery !== null ? `${avgQuizMastery}%` : 'No quizzes'}
          </p>
          <p className="text-xs text-muted tabular-nums">
            {quizScores.length} {quizScores.length === 1 ? 'topic' : 'topics'} assessed
          </p>
        </div>
      </Surface>

      {/* Analytical Graphs Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left Graph: 7-Day Study Activity Bar Chart */}
        <Surface className="lg:col-span-7 p-5 sm:p-6 flex flex-col justify-between space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-0.5 min-w-0">
              <h3 className="text-lg font-editorial font-medium text-foreground">
                Daily study time (last 7 days)
              </h3>
              <p className="text-xs text-muted tabular-nums">
                {activeDay.shortDay}, {activeDay.dateLabel}:{' '}
                <strong className="text-foreground">{activeDay.minutes} min</strong> studied
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <label htmlFor="daily-goal-select" className="text-muted whitespace-nowrap">
                Daily goal:
              </label>
              <select
                id="daily-goal-select"
                value={metrics.dailyGoalMinutes}
                onChange={(e) => onChangeDailyGoal(Number(e.target.value))}
                className="rounded-control border border-border bg-background px-2 py-1 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-primary"
              >
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
                <option value={60}>60 min</option>
                <option value={90}>90 min</option>
                <option value={120}>120 min</option>
              </select>
            </div>
          </div>

          <svg
            viewBox={`0 0 ${chartW} ${chartH}`}
            className="w-full h-auto"
            role="img"
            aria-label="7-day bar chart of daily study minutes compared against daily goal"
          >
            {/* Horizontal grid lines */}
            {yTicks.map((tick) => {
              const y = padTop + plotH - (tick / yCeiling) * plotH;
              return (
                <g key={tick}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={chartW - padRight}
                    y2={y}
                    stroke="var(--color-border)"
                    strokeWidth="1"
                  />
                  <text
                    x={padLeft - 8}
                    y={y + 4}
                    textAnchor="end"
                    fontSize="10"
                    fontFamily="JetBrains Mono, monospace"
                    fill="var(--color-muted)"
                    style={{
                      paintOrder: 'stroke',
                      stroke: 'var(--color-surface)',
                      strokeWidth: '4px',
                    }}
                  >
                    {tick}m
                  </text>
                </g>
              );
            })}

            {/* Daily goal dashed threshold line */}
            <line
              x1={padLeft}
              y1={goalY}
              x2={chartW - padRight}
              y2={goalY}
              stroke="var(--color-accent)"
              strokeWidth="1.25"
              strokeDasharray="4 4"
            />
            <text
              x={chartW - padRight}
              y={goalY - 5}
              textAnchor="end"
              fontSize="10"
              fontFamily="JetBrains Mono, monospace"
              fill="var(--color-accent)"
              style={{
                paintOrder: 'stroke',
                stroke: 'var(--color-surface)',
                strokeWidth: '4px',
              }}
            >
              Goal {metrics.dailyGoalMinutes}m
            </text>

            {/* Bars starting at zero baseline */}
            {weekSeries.map((day, idx) => {
              const barH = Math.max(2, (day.minutes / yCeiling) * plotH);
              const x = padLeft + idx * slotW + (slotW - barW) / 2;
              const y = padTop + plotH - barH;
              const isToday = day.key === todayKey;
              const isSelected = activeDay.key === day.key;

              return (
                <g
                  key={day.key}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredDayKey(day.key)}
                  onClick={() => setHoveredDayKey(day.key)}
                >
                  <rect
                    x={x}
                    y={y}
                    width={barW}
                    height={barH}
                    rx="3"
                    fill={
                      day.minutes >= metrics.dailyGoalMinutes || isToday
                        ? 'var(--color-primary)'
                        : 'var(--color-muted)'
                    }
                    fillOpacity={isSelected ? 1 : 0.72}
                  />
                  {day.minutes > 0 && (
                    <text
                      x={x + barW / 2}
                      y={y - 5}
                      textAnchor="middle"
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                      fill="var(--color-foreground)"
                      style={{
                        paintOrder: 'stroke',
                        stroke: 'var(--color-surface)',
                        strokeWidth: '4px',
                      }}
                    >
                      {day.minutes}
                    </text>
                  )}
                  <text
                    x={x + barW / 2}
                    y={padTop + plotH + 16}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight={isToday ? '600' : '400'}
                    fill={isToday ? 'var(--color-primary)' : 'var(--color-muted)'}
                  >
                    {day.shortDay}
                  </text>
                </g>
              );
            })}
          </svg>

          <p className="text-xs text-muted">
            Active minutes are recorded automatically while reading, chatting, or taking quizzes.
          </p>
        </Surface>

        {/* Right Graph: Course Mastery & RAG Grounding Breakdown */}
        <Surface className="lg:col-span-5 p-5 sm:p-6 divide-y divide-border flex flex-col justify-between">
          <div className="pb-4 space-y-3">
            <div className="space-y-0.5">
              <h3 className="text-lg font-editorial font-medium text-foreground">
                Topic progress &amp; mastery
              </h3>
              <p className="text-xs text-muted">
                Derived from completed notes, summaries, and quiz accuracy
              </p>
            </div>

            {workspace.documents.length === 0 ? (
              <p className="text-xs text-muted py-4">
                Upload a course PDF to track per-topic mastery.
              </p>
            ) : (
              <div className="space-y-3 pt-1">
                {workspace.documents.slice(0, 4).map((doc) => {
                  const isDone = metrics.completedDocIds.includes(doc.id);
                  const hasSummary = Boolean(workspace.summariesByDoc[doc.id]);
                  const quiz = workspace.quizzesByDoc[doc.id];
                  const quizScore = quiz?.bestScore ?? null;
                  // Weighted readiness score out of 100 based on actual artifacts
                  const readiness = Math.min(
                    100,
                    (isDone ? 40 : 15) +
                      (hasSummary ? 25 : 0) +
                      (quizScore !== null ? Math.round(quizScore * 0.35) : 0)
                  );

                  return (
                    <div key={doc.id} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-foreground font-medium truncate" title={doc.title}>
                          {doc.title}
                        </span>
                        <span className="font-mono text-muted shrink-0 tabular-nums">
                          {readiness}%
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-control bg-background border border-border overflow-hidden">
                        <div
                          className="h-full bg-primary transition-[width] duration-300"
                          style={{ width: `${readiness}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Grounded vs Clarifier vs Standard AI Query Distribution */}
          <div className="pt-4 space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-sm font-editorial font-medium text-foreground">
                Study query breakdown
              </h4>
              <span className="text-xs font-mono text-muted tabular-nums">
                {modeCounts.total} total queries
              </span>
            </div>

            {modeCounts.total === 0 ? (
              <p className="text-xs text-muted">
                Ask a question in Doubt-clearing chat to track grounded vs. general queries.
              </p>
            ) : (
              <>
                <div className="w-full h-2.5 rounded-control overflow-hidden flex border border-border bg-background">
                  {modeCounts.rag > 0 && (
                    <div
                      className="h-full bg-primary"
                      style={{
                        width: `${(modeCounts.rag / modeCounts.total) * 100}%`,
                      }}
                      title={`Grounded RAG: ${modeCounts.rag}`}
                    />
                  )}
                  {modeCounts.clarifier > 0 && (
                    <div
                      className="h-full bg-accent"
                      style={{
                        width: `${(modeCounts.clarifier / modeCounts.total) * 100}%`,
                      }}
                      title={`Concept Clarifier: ${modeCounts.clarifier}`}
                    />
                  )}
                  {modeCounts.comparisons > 0 && (
                    <div
                      className="h-full bg-muted"
                      style={{
                        width: `${(modeCounts.comparisons / modeCounts.total) * 100}%`,
                      }}
                      title={`RAG vs. Standard AI: ${modeCounts.comparisons}`}
                    />
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted tabular-nums">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-primary inline-block" />
                    Grounded RAG ({modeCounts.rag})
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-accent inline-block" />
                    Concept Clarifier ({modeCounts.clarifier})
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-muted inline-block" />
                    Evaluations ({modeCounts.comparisons})
                  </span>
                </div>
              </>
            )}
          </div>
        </Surface>
      </div>

      {/* Course Binder & Topic Completion Ledger */}
      <Surface className="divide-y divide-border">
        <div className="p-5 sm:px-6 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h3 className="text-lg font-editorial font-medium text-foreground">
              Course materials &amp; topic checklist
            </h3>
            <p className="text-xs text-muted">
              Mark topics complete as you revise and jump directly into notes, summaries, or quizzes.
            </p>
          </div>
          <Button tone="quiet" onClick={onOpenUpload}>
            <Plus className="w-3.5 h-3.5 text-primary" />
            <span>Add study material</span>
          </Button>
        </div>

        {workspace.documents.length === 0 ? (
          <div className="p-8 text-center space-y-3">
            <p className="text-sm text-muted">
              No course PDFs uploaded yet. Upload your first document to begin tracking progress.
            </p>
            <Button tone="primary" onClick={onOpenUpload}>
              Upload PDF or lecture notes
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-xs font-medium text-muted uppercase tracking-wider">
                  <th className="py-3 px-5">Status</th>
                  <th className="py-3 px-4">Course &amp; document</th>
                  <th className="py-3 px-4 text-right">Time</th>
                  <th className="py-3 px-4 text-right">Quiz</th>
                  <th className="py-3 px-5 text-right">Study tools</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {workspace.documents.map((doc) => {
                  const isDone = metrics.completedDocIds.includes(doc.id);
                  const docMins = metrics.minutesByDoc[doc.id] ?? 0;
                  const quiz = workspace.quizzesByDoc[doc.id];
                  const hasSummary = Boolean(workspace.summariesByDoc[doc.id]);

                  return (
                    <tr key={doc.id} className="hover:bg-background/60 transition-colors">
                      <td className="py-3 px-5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onToggleTopicComplete(doc.id)}
                          aria-pressed={isDone}
                          className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-control px-2 py-1 border transition-colors ${
                            isDone
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-surface text-muted hover:text-foreground'
                          }`}
                        >
                          {isDone ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Completed</span>
                            </>
                          ) : (
                            <>
                              <Circle className="w-3.5 h-3.5" />
                              <span>Mark done</span>
                            </>
                          )}
                        </button>
                      </td>

                      <td className="py-3 px-4 min-w-[220px]">
                        <p className="font-medium text-foreground">{doc.title}</p>
                        <p className="text-xs text-muted font-mono mt-0.5">
                          {doc.courseCode} · {doc.pageCount}p · {doc.chunks.length} chunks
                          {hasSummary ? ' · Summary saved' : ''}
                        </p>
                      </td>

                      <td className="py-3 px-4 text-right font-mono text-xs text-foreground tabular-nums whitespace-nowrap">
                        {formatDuration(docMins)}
                      </td>

                      <td className="py-3 px-4 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                        {quiz?.bestScore !== undefined ? (
                          <span className="text-primary font-medium">{quiz.bestScore}%</span>
                        ) : (
                          <span className="text-muted">Not taken</span>
                        )}
                      </td>

                      <td className="py-3 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onOpenDocumentTool(doc.id, 'chat')}
                            title="Open doubt-clearing chat"
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-control border border-border bg-surface text-foreground hover:border-primary"
                          >
                            <MessageSquareText className="w-3 h-3 text-primary" />
                            <span>Chat</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenDocumentTool(doc.id, 'summary')}
                            title="Open revision summary"
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-control border border-border bg-surface text-foreground hover:border-primary"
                          >
                            <FileText className="w-3 h-3 text-primary" />
                            <span>Summary</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenDocumentTool(doc.id, 'quiz')}
                            title="Open practice quiz"
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-control border border-border bg-surface text-foreground hover:border-primary"
                          >
                            <ListChecks className="w-3 h-3 text-primary" />
                            <span>Quiz</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Surface>
    </div>
  );
}
