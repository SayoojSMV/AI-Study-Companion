import { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { ArrowRight, BookOpen, Loader2, Moon, Sun } from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { continueAsDemoStudent } from '../lib/storage';
import type { StudentUser } from '../types';
import { Button, Surface } from './ui';

interface AuthViewProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onAuthenticated: (user: StudentUser) => void;
}

export function AuthView({ theme, onToggleTheme, onAuthenticated }: AuthViewProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleGoogleSignIn = async () => {
    if (busy) return;
    setBusy(true);
    setError('');

    try {
      await signInWithPopup(auth, googleProvider);
      // App.tsx's onAuthStateChanged listener hydrates profile & Firestore workspace
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('popup-closed-by-user')) {
        setError('Google sign-in popup was closed before completion. Try again when ready.');
      } else if (msg.includes('auth/unauthorized-domain')) {
        setError(
          `Domain "${window.location.hostname}" is not listed in Firebase Console → Authentication → Settings → Authorized domains. Add "${window.location.hostname}" (or open via http://localhost:3000 instead of 127.0.0.1).`
        );
      } else if (msg.includes('auth/popup-blocked')) {
        setError(
          'Your browser blocked the Google sign-in popup. Allow popups for this site and retry.'
        );
      } else if (msg.includes('Quota exceeded')) {
        setError(
          'Daily Cloud Firestore free-tier quota exceeded. Quota resets tomorrow, or continue as Demo Student for local preview.'
        );
      } else {
        setError(msg || 'Unable to sign in with Google. Please try again.');
      }
      setBusy(false);
    }
  };

  const handleDemoLogin = () => {
    const demoUser = continueAsDemoStudent();
    onAuthenticated(demoUser);
  };

  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col justify-between">
      <header className="border-b border-border bg-surface/60">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <BookOpen className="w-5 h-5 text-primary shrink-0" />
            <span className="font-editorial text-lg font-medium tracking-tight">
              AI Study Companion
            </span>
          </div>
          <div className="flex items-center gap-4">
            <p className="text-xs text-muted hidden sm:block">
              Center for Artificial Intelligence &amp; Machine Learning · Course RAG Workbench
            </p>
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-control border border-border bg-surface text-xs text-foreground hover:border-primary"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="w-3.5 h-3.5 text-accent" />
                  <span>Light</span>
                </>
              ) : (
                <>
                  <Moon className="w-3.5 h-3.5 text-primary" />
                  <span>Dark</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl w-full mx-auto px-6 py-10 md:py-16 grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        {/* Editorial Academic Monograph Column */}
        <section className="lg:col-span-7 space-y-6 min-w-0">
          <p className="text-xs text-primary font-medium">
            Retrieval-Augmented Generation · Student Research Desk
          </p>
          <h1 className="text-3xl sm:text-4xl font-editorial font-medium leading-tight text-foreground max-w-[24ch]">
            Revise directly from your own lecture notes, formulas, and lab rubrics.
          </h1>
          <p className="text-base text-muted leading-relaxed max-w-[58ch]">
            Generic chatbots extrapolate from broad internet training data and miss course-specific
            definitions. Sign in to keep your syllabus PDFs, overlapping semantic chunks, cited
            Q&amp;A threads, study dashboard, and quizzes private in Cloud Firestore.
          </p>

          {/* Self-contained SVG RAG Architecture Figure */}
          <div className="pt-2 space-y-2">
            <svg
              viewBox="0 0 680 128"
              className="w-full max-w-2xl h-auto rounded-card border border-border bg-surface"
              role="img"
              aria-label="Four-stage Retrieval-Augmented Generation pipeline from PDF upload to grounded citation"
            >
              <g stroke="var(--color-border)" strokeWidth="1.5" fill="none">
                <line x1="152" y1="64" x2="184" y2="64" />
                <polyline points="178,59 184,64 178,69" stroke="var(--color-primary)" />
                <line x1="324" y1="64" x2="356" y2="64" />
                <polyline points="350,59 356,64 350,69" stroke="var(--color-primary)" />
                <line x1="496" y1="64" x2="528" y2="64" />
                <polyline points="522,59 528,64 522,69" stroke="var(--color-primary)" />
              </g>

              <g fill="var(--color-background)" stroke="var(--color-border)" strokeWidth="1">
                <rect x="16" y="26" width="136" height="76" rx="4" />
                <rect x="188" y="26" width="136" height="76" rx="4" />
                <rect x="360" y="26" width="136" height="76" rx="4" />
                <rect x="532" y="26" width="132" height="76" rx="4" stroke="var(--color-primary)" />
              </g>

              <g
                fontFamily="Plus Jakarta Sans, sans-serif"
                fill="var(--color-foreground)"
                style={{
                  paintOrder: 'stroke',
                  stroke: 'var(--color-background)',
                  strokeWidth: '3px',
                  strokeLinejoin: 'round',
                }}
              >
                <text x="28" y="52" fontSize="12" fontWeight="600">
                  1. PDF parse
                </text>
                <text x="28" y="72" fontSize="11" fill="var(--color-muted)">
                  Page-aware text
                </text>
                <text x="28" y="88" fontSize="10" fontFamily="JetBrains Mono, monospace" fill="var(--color-muted)">
                  pdf.js client
                </text>

                <text x="200" y="52" fontSize="12" fontWeight="600">
                  2. Chunking
                </text>
                <text x="200" y="72" fontSize="11" fill="var(--color-muted)">
                  Private chunks
                </text>
                <text x="200" y="88" fontSize="10" fontFamily="JetBrains Mono, monospace" fill="var(--color-muted)">
                  660c · 125c
                </text>

                <text x="372" y="52" fontSize="12" fontWeight="600">
                  3. Vector index
                </text>
                <text x="372" y="72" fontSize="11" fill="var(--color-muted)">
                  Cosine search
                </text>
                <text x="372" y="88" fontSize="10" fontFamily="JetBrains Mono, monospace" fill="var(--color-muted)">
                  cos(u, v)
                </text>

                <text x="544" y="52" fontSize="12" fontWeight="600" fill="var(--color-primary)">
                  4. Cited answer
                </text>
                <text x="544" y="72" fontSize="11" fill="var(--color-muted)">
                  Page &amp; passage
                </text>
                <text x="544" y="88" fontSize="10" fontFamily="JetBrains Mono, monospace" fill="var(--color-primary)">
                  [p. 4, #07]
                </text>
              </g>
            </svg>
            <p className="text-xs text-muted">
              Privacy guarantee: uploaded PDFs, embeddings, chat threads, and study metrics are
              strictly isolated to your verified student UID in Firestore.
            </p>
          </div>
        </section>

        {/* Authentication Card */}
        <section className="lg:col-span-5 min-w-0">
          <Surface className="p-6 sm:p-7 divide-y divide-border">
            <div className="pb-5 space-y-4">
              <div className="space-y-1.5">
                <h2 className="text-xl font-editorial font-medium">
                  Student workspace sign-in
                </h2>
                <p className="text-xs text-muted leading-relaxed">
                  Sign in with your Google account to sync your private course binder, study
                  time metrics, and quiz progress to Cloud Firestore.
                </p>
              </div>

              {error && (
                <p role="alert" className="text-xs text-accent leading-relaxed">
                  {error}
                </p>
              )}

              <Button
                type="button"
                tone="primary"
                disabled={busy}
                onClick={() => void handleGoogleSignIn()}
                className="w-full"
              >
                {busy ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Connecting to Firebase...</span>
                  </>
                ) : (
                  <>
                    <span>Sign in with Google</span>
                    <ArrowRight className="w-4 h-4 shrink-0" />
                  </>
                )}
              </Button>
            </div>

            <div className="pt-5 space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Quick academic preview
                </p>
                <p className="text-xs text-muted leading-relaxed">
                  Open Ananya Rao&apos;s pre-indexed CS-402 study desk locally with Lecture 07
                  &amp; Lecture 11 notes, study dashboard, revision sheet, and 5-question quiz.
                </p>
              </div>
              <Button
                type="button"
                tone="quiet"
                disabled={busy}
                onClick={handleDemoLogin}
                className="w-full justify-between"
              >
                <span>Continue as Demo Student</span>
                <ArrowRight className="w-4 h-4 text-primary shrink-0" />
              </Button>
            </div>
          </Surface>
        </section>
      </main>

      <footer className="border-t border-border py-4 px-6 text-xs text-muted">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <span>AI Study Companion · Grounded Course Revision</span>
          <span>Firebase Auth · Private Cloud Firestore · Cosine RAG</span>
        </div>
      </footer>
    </div>
  );
}
