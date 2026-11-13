import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  BookOpen,
  FileText,
  Layers,
  LayoutDashboard,
  ListChecks,
  Loader2,
  LogOut,
  MessageSquareText,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  Scale,
  Sun,
  Trash2,
} from 'lucide-react';
import { AuthView } from './components/AuthView';
import { ChatCanvas } from './components/ChatCanvas';
import { ChunksInspectorView } from './components/ChunksInspectorView';
import { ComparisonView } from './components/ComparisonView';
import { QuizView } from './components/QuizView';
import { StudentAvatar } from './components/StudentAvatar';
import { StudyDashboard } from './components/StudyDashboard';
import { SummaryView } from './components/SummaryView';
import { UploadModal } from './components/UploadModal';
import { Button } from './components/ui';
import { getLocalDateKey } from './data/seedWorkspace';
import { generateGeminiEmbeddings } from './lib/apiClient';
import { auth, googleProvider, isFirebaseConfigured } from './lib/firebase';
import {
  appendMessagesToFirestore,
  clearMessagesInFirestore,
  deleteDocumentFromFirestore,
  ensureStudentProfileInFirestore,
  fetchStudentWorkspaceFromFirestore,
  saveComparisonToFirestore,
  saveDocumentToFirestore,
  saveQuizToFirestore,
  saveStudyMetricsToFirestore,
  saveSummaryToFirestore,
  updateChunkEmbeddingsInFirestore,
} from './lib/firestoreWorkspace';
import {
  getCurrentSessionUser,
  loadThemePreference,
  loadWorkspaceData,
  resetWorkspaceToDefault,
  saveThemePreference,
  saveWorkspaceData,
  setSessionUser,
} from './lib/storage';
import type {
  ChatMessage,
  ComparisonRun,
  DocumentChunk,
  RevisionSummary,
  SavedQuiz,
  StudentUser,
  StudentWorkspaceData,
  StudyDocument,
  StudyMetrics,
  WorkspaceTab,
} from './types';

export default function App() {
  const [user, setUser] = useState<StudentUser | null>(() =>
    getCurrentSessionUser()
  );
  const [workspace, setWorkspace] = useState<StudentWorkspaceData | null>(() => {
    const u = getCurrentSessionUser();
    return u?.isDemo ? loadWorkspaceData(u) : null;
  });

  const [theme, setTheme] = useState<'light' | 'dark'>(() => loadThemePreference());
  const [cloudLoading, setCloudLoading] = useState(() => {
    const u = getCurrentSessionUser();
    return Boolean(u && !u.isDemo && isFirebaseConfigured);
  });
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingComparisonQuestion, setPendingComparisonQuestion] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const workspaceRef = useRef<StudentWorkspaceData | null>(workspace);
  workspaceRef.current = workspace;
  const activeDocIdRef = useRef<string | null>(activeDocId);
  activeDocIdRef.current = activeDocId;

  const isCloudUser = Boolean(user && !user.isDemo);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    saveThemePreference(theme);
  }, [theme]);

  const handleToggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Listen to Firebase Authentication state changes
  useEffect(() => {
    if (!auth) {
      setCloudLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setCloudLoading(false);
        return;
      }

      setCloudLoading(true);
      setCloudError(null);
      try {
        const profile = await ensureStudentProfileInFirestore(fbUser);
        const cloudWorkspace = await fetchStudentWorkspaceFromFirestore(fbUser.uid);
        setSessionUser(profile);
        setUser(profile);
        setWorkspace(cloudWorkspace);
        setActiveDocId(cloudWorkspace.documents[0]?.id ?? null);
        setStatusBanner(`Signed in as ${profile.name} · Synced with Cloud Firestore.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Quota exceeded')) {
          setCloudError(
            'Daily Cloud Firestore free-tier quota exceeded. Quota resets tomorrow.'
          );
        } else {
          setCloudError(
            'Could not load Cloud Firestore workspace. Please refresh or check your permissions.'
          );
        }
      } finally {
        setCloudLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // Sync active document selection when user or documents change
  useEffect(() => {
    if (!workspace) return;
    if (
      !activeDocId ||
      !workspace.documents.some((d) => d.id === activeDocId)
    ) {
      setActiveDocId(workspace.documents[0]?.id ?? null);
    }
  }, [workspace, activeDocId]);

  // Background-hydrate Gemini dense embeddings for documents missing them
  useEffect(() => {
    if (!user || !workspace) return;
    const targetDoc = workspace.documents.find((d) =>
      d.chunks.some((c) => !c.geminiEmbedding || c.geminiEmbedding.length === 0)
    );
    if (!targetDoc) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await generateGeminiEmbeddings(
          targetDoc.chunks.map((c) => c.text)
        );
        if (cancelled || res.embeddings.length !== targetDoc.chunks.length) return;

        const updatedChunks = targetDoc.chunks.map((ch, idx) => ({
          ...ch,
          geminiEmbedding: res.embeddings[idx],
        }));
        const dims = res.dimensions || res.embeddings[0]?.length || 768;

        setWorkspace((prev) => {
          if (!prev) return prev;
          const nextDocs = prev.documents.map((doc) => {
            if (doc.id !== targetDoc.id) return doc;
            return {
              ...doc,
              embeddingModel: res.model,
              embeddingDimensions: dims,
              chunks: updatedChunks,
            };
          });
          const next = { ...prev, documents: nextDocs };
          if (user.isDemo) saveWorkspaceData(user.id, next);
          return next;
        });

        if (!user.isDemo) {
          await updateChunkEmbeddingsInFirestore(
            user.id,
            targetDoc.id,
            updatedChunks,
            res.model,
            dims
          );
        }
      } catch {
        // Silent fallback: local L2-normalized cosine embeddings remain active
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, workspace?.documents.length]);

  // Track active study minutes automatically while the student's tab is visible
  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const currentWs = workspaceRef.current;
      if (!currentWs) return;
      const todayKey = getLocalDateKey(0);
      const docId = activeDocIdRef.current ?? currentWs.documents[0]?.id ?? null;
      const nextMetrics: StudyMetrics = {
        ...currentWs.studyMetrics,
        dailyMinutes: {
          ...currentWs.studyMetrics.dailyMinutes,
          [todayKey]: (currentWs.studyMetrics.dailyMinutes[todayKey] ?? 0) + 1,
        },
        minutesByDoc: docId
          ? {
              ...currentWs.studyMetrics.minutesByDoc,
              [docId]: (currentWs.studyMetrics.minutesByDoc[docId] ?? 0) + 1,
            }
          : currentWs.studyMetrics.minutesByDoc,
      };

      setWorkspace((prev) => {
        if (!prev) return prev;
        const next = { ...prev, studyMetrics: nextMetrics };
        if (user.isDemo) saveWorkspaceData(user.id, next);
        return next;
      });

      if (!user.isDemo) {
        void saveStudyMetricsToFirestore(user.id, nextMetrics).catch((err) => {
          setCloudError(err instanceof Error ? err.message : 'Failed to sync study time.');
        });
      }
    }, 60_000);

    return () => window.clearInterval(timer);
  }, [user?.id, user?.isDemo]);

  const handleAuthenticated = async (authedUser: StudentUser) => {
    setUser(authedUser);
    setSessionUser(authedUser);
    if (authedUser.isDemo) {
      const ws = loadWorkspaceData(authedUser);
      setWorkspace(ws);
      setActiveDocId(ws.documents[0]?.id ?? null);
      setActiveTab('dashboard');
    } else {
      setCloudLoading(true);
      try {
        const cloudWs = await fetchStudentWorkspaceFromFirestore(authedUser.id);
        setWorkspace(cloudWs);
        setActiveDocId(cloudWs.documents[0]?.id ?? null);
        setActiveTab('dashboard');
      } finally {
        setCloudLoading(false);
      }
    }
  };

  const handleUpgradeDemoToGoogle = async () => {
    setCloudError(null);
    if (!isFirebaseConfigured || !auth) {
      setCloudError(
        'Firebase is not configured in this deployment. Add VITE_FIREBASE_* environment variables in Vercel or .env to enable Google Sign-In.'
      );
      return;
    }
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('popup-closed-by-user')) {
        setCloudError(msg);
      }
    }
  };

  const handleSignOut = async () => {
    if (auth?.currentUser) {
      await signOut(auth);
    }
    setSessionUser(null);
    setUser(null);
    setWorkspace(null);
    setMobileMenuOpen(false);
  };

  if (cloudLoading && !workspace) {
    return (
      <div className="min-h-dvh bg-background text-foreground flex items-center justify-center p-6">
        <div className="flex items-center gap-3 text-sm text-muted">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span>Loading your Firestore study binder...</span>
        </div>
      </div>
    );
  }

  if (!user || !workspace) {
    return (
      <AuthView
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onAuthenticated={(u) => void handleAuthenticated(u)}
      />
    );
  }

  const updateLocalWorkspace = (
    updater: (prev: StudentWorkspaceData) => StudentWorkspaceData
  ) => {
    setWorkspace((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      if (user.isDemo) {
        saveWorkspaceData(user.id, next);
      }
      return next;
    });
  };

  const activeDoc =
    workspace.documents.find((d) => d.id === activeDocId) ??
    workspace.documents[0] ??
    null;

  const totalChunks = workspace.documents.reduce(
    (sum, d) => sum + d.chunks.length,
    0
  );
  const savedSummaryCount = Object.keys(workspace.summariesByDoc).length;
  const savedQuizCount = Object.keys(workspace.quizzesByDoc).length;

  const handleDocumentIndexed = async (newDoc: StudyDocument) => {
    updateLocalWorkspace((prev) => ({
      ...prev,
      documents: [newDoc, ...prev.documents],
      messagesByDoc: { ...prev.messagesByDoc, [newDoc.id]: [] },
    }));
    setActiveDocId(newDoc.id);
    setActiveTab('chat');

    if (isCloudUser) {
      try {
        await saveDocumentToFirestore(user.id, newDoc);
        setStatusBanner(
          `Indexed "${newDoc.title}" (${newDoc.chunks.length} chunks) and saved to Cloud Firestore.`
        );
      } catch (err) {
        setCloudError(err instanceof Error ? err.message : 'Failed to save document to Firestore.');
      }
    } else {
      setStatusBanner(
        `Indexed "${newDoc.title}" (${newDoc.chunks.length} semantic chunks across ${newDoc.pageCount} pages).`
      );
    }
  };

  const handleDeleteDocument = async (docId: string) => {
    const target = workspace.documents.find((d) => d.id === docId);
    updateLocalWorkspace((prev) => {
      const nextDocs = prev.documents.filter((d) => d.id !== docId);
      const nextMessages = { ...prev.messagesByDoc };
      const nextSummaries = { ...prev.summariesByDoc };
      const nextQuizzes = { ...prev.quizzesByDoc };
      delete nextMessages[docId];
      delete nextSummaries[docId];
      delete nextQuizzes[docId];
      return {
        ...prev,
        documents: nextDocs,
        messagesByDoc: nextMessages,
        summariesByDoc: nextSummaries,
        quizzesByDoc: nextQuizzes,
      };
    });

    if (isCloudUser) {
      try {
        await deleteDocumentFromFirestore(user.id, docId);
      } catch (err) {
        setCloudError(err instanceof Error ? err.message : 'Failed to delete document from Firestore.');
      }
    }

    if (target) {
      setStatusBanner(`Removed "${target.title}" from your study binder.`);
    }
  };

  const handleResetWorkspace = () => {
    if (!user.isDemo) return;
    const fresh = resetWorkspaceToDefault(user);
    setWorkspace(fresh);
    setActiveDocId(fresh.documents[0]?.id ?? null);
    setActiveTab('dashboard');
    setStatusBanner('Restored default course binder and revision records.');
  };

  const handleToggleTopicComplete = async (docId: string) => {
    const currentIds = workspace.studyMetrics.completedDocIds;
    const exists = currentIds.includes(docId);
    const nextIds = exists
      ? currentIds.filter((id) => id !== docId)
      : [...currentIds, docId];
    const nextMetrics: StudyMetrics = {
      ...workspace.studyMetrics,
      completedDocIds: nextIds,
    };

    updateLocalWorkspace((prev) => ({
      ...prev,
      studyMetrics: nextMetrics,
    }));

    if (isCloudUser) {
      try {
        await saveStudyMetricsToFirestore(user.id, nextMetrics);
      } catch (err) {
        setCloudError(err instanceof Error ? err.message : 'Failed to update topic completion.');
      }
    }
  };

  const handleChangeDailyGoal = async (minutes: number) => {
    const nextMetrics: StudyMetrics = {
      ...workspace.studyMetrics,
      dailyGoalMinutes: minutes,
    };

    updateLocalWorkspace((prev) => ({
      ...prev,
      studyMetrics: nextMetrics,
    }));

    if (isCloudUser) {
      try {
        await saveStudyMetricsToFirestore(user.id, nextMetrics);
      } catch (err) {
        setCloudError(err instanceof Error ? err.message : 'Failed to update daily study goal.');
      }
    }
  };

  const handleOpenDocumentTool = (docId: string, tab: WorkspaceTab) => {
    setActiveDocId(docId);
    setActiveTab(tab);
  };

  const handleAppendMessages = async (newMsgs: ChatMessage[]) => {
    if (!activeDoc) return;
    updateLocalWorkspace((prev) => ({
      ...prev,
      messagesByDoc: {
        ...prev.messagesByDoc,
        [activeDoc.id]: [
          ...(prev.messagesByDoc[activeDoc.id] ?? []),
          ...newMsgs,
        ],
      },
    }));

    if (isCloudUser) {
      try {
        await appendMessagesToFirestore(user.id, activeDoc.id, newMsgs);
      } catch (err) {
        setCloudError(err instanceof Error ? err.message : 'Failed to persist chat message.');
      }
    }
  };

  const handleClearChat = async () => {
    if (!activeDoc) return;
    updateLocalWorkspace((prev) => ({
      ...prev,
      messagesByDoc: {
        ...prev.messagesByDoc,
        [activeDoc.id]: [],
      },
    }));

    if (isCloudUser) {
      try {
        await clearMessagesInFirestore(user.id, activeDoc.id);
      } catch (err) {
        setCloudError(err instanceof Error ? err.message : 'Failed to clear Firestore chat thread.');
      }
    }
  };

  const handleHydrateDocChunks = async (docId: string, updatedChunks: DocumentChunk[]) => {
    const dims = updatedChunks[0]?.geminiEmbedding?.length ?? 768;
    updateLocalWorkspace((prev) => ({
      ...prev,
      documents: prev.documents.map((d) =>
        d.id === docId
          ? {
              ...d,
              embeddingModel: 'gemini-embedding-2',
              embeddingDimensions: dims,
              chunks: updatedChunks,
            }
          : d
      ),
    }));

    if (isCloudUser) {
      try {
        await updateChunkEmbeddingsInFirestore(
          user.id,
          docId,
          updatedChunks,
          'gemini-embedding-2',
          dims
        );
      } catch {
        // Non-blocking sync
      }
    }
  };

  const handleSaveSummary = async (summary: RevisionSummary) => {
    updateLocalWorkspace((prev) => ({
      ...prev,
      summariesByDoc: {
        ...prev.summariesByDoc,
        [summary.docId]: summary,
      },
    }));

    if (isCloudUser) {
      try {
        await saveSummaryToFirestore(user.id, summary);
      } catch (err) {
        setCloudError(err instanceof Error ? err.message : 'Failed to save summary to Firestore.');
      }
    }
  };

  const handleSaveQuiz = async (quiz: SavedQuiz) => {
    updateLocalWorkspace((prev) => ({
      ...prev,
      quizzesByDoc: {
        ...prev.quizzesByDoc,
        [quiz.docId]: quiz,
      },
    }));

    if (isCloudUser) {
      try {
        await saveQuizToFirestore(user.id, quiz);
      } catch (err) {
        setCloudError(err instanceof Error ? err.message : 'Failed to save quiz progress.');
      }
    }
  };

  const handleSaveComparison = async (run: ComparisonRun) => {
    updateLocalWorkspace((prev) => ({
      ...prev,
      comparisons: [run, ...prev.comparisons],
    }));

    if (isCloudUser) {
      try {
        await saveComparisonToFirestore(user.id, run);
      } catch (err) {
        setCloudError(err instanceof Error ? err.message : 'Failed to save comparison run.');
      }
    }
  };

  const handleLaunchComparisonFromChat = (question: string) => {
    setPendingComparisonQuestion(question);
    setActiveTab('compare');
  };

  const navTools: Array<{
    id: WorkspaceTab;
    label: string;
    icon: typeof MessageSquareText;
  }> = [
    { id: 'dashboard', label: 'Study dashboard', icon: LayoutDashboard },
    { id: 'chat', label: 'Doubt-clearing chat', icon: MessageSquareText },
    { id: 'summary', label: 'Revision summary', icon: FileText },
    { id: 'quiz', label: 'Practice quiz (5 Qs)', icon: ListChecks },
    { id: 'compare', label: 'Compare vs. Standard AI', icon: Scale },
    { id: 'chunks', label: 'Vector chunk index', icon: Layers },
  ];

  const renderSidebarContents = () => (
    <div className="flex flex-col h-full divide-y divide-border">
      {/* Brand Header */}
      <div className="px-4 py-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <BookOpen className="w-5 h-5 text-primary shrink-0" />
          <span className="font-editorial text-base font-medium truncate">
            AI Study Companion
          </span>
        </div>
        <button
          type="button"
          onClick={() => setSidebarCollapsed(true)}
          aria-label="Collapse study sidebar"
          className="hidden md:inline-flex p-1.5 rounded-control text-muted hover:text-foreground hover:bg-background focus-visible:outline-2 focus-visible:outline-primary"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      {/* Uploaded Course Documents Section */}
      <div className="p-4 space-y-3 flex-1 min-h-0 overflow-y-auto">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-medium text-muted">
            Course binder ({workspace.documents.length})
          </h2>
          <button
            type="button"
            onClick={() => {
              setUploadOpen(true);
              setMobileMenuOpen(false);
            }}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline whitespace-nowrap focus-visible:outline-2 focus-visible:outline-primary rounded-control"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Upload PDF</span>
          </button>
        </div>

        {workspace.documents.length === 0 ? (
          <p className="text-xs text-muted py-2 leading-relaxed">
            No course materials uploaded yet. Add a PDF or lecture note to index embeddings.
          </p>
        ) : (
          <ul className="space-y-1">
            {workspace.documents.map((doc) => {
              const isSelected = activeDoc?.id === doc.id;
              return (
                <li key={doc.id} className="group flex items-start gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveDocId(doc.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex-1 min-w-0 text-left px-2.5 py-2 rounded-control transition-colors ${
                      isSelected
                        ? 'bg-primary text-primary-foreground'
                        : 'text-foreground hover:bg-background'
                    }`}
                  >
                    <p className="text-xs font-medium truncate" title={doc.title}>
                      {doc.title}
                    </p>
                    <p
                      className={`text-[11px] font-mono mt-0.5 ${
                        isSelected ? 'text-primary-foreground/80' : 'text-muted'
                      }`}
                    >
                      {doc.courseCode} · {doc.pageCount}p · {doc.chunks.length} chunks
                    </p>
                  </button>
                  {workspace.documents.length > 1 && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteDocument(doc.id)}
                      aria-label={`Remove ${doc.title}`}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1.5 mt-1 text-muted hover:text-accent rounded-control transition-opacity"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Study & Revision Tools */}
        <div className="pt-4 border-t border-border space-y-1.5">
          <h2 className="text-xs font-medium text-muted pb-1">
            Revision &amp; evaluation tools
          </h2>
          {navTools.map((tool) => {
            const Icon = tool.icon;
            const isCurrent = activeTab === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => {
                  setActiveTab(tool.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-control text-xs font-medium whitespace-nowrap transition-colors ${
                  isCurrent
                    ? 'bg-background text-primary border border-border'
                    : 'text-muted hover:text-foreground hover:bg-background/70'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{tool.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom Student Card & Cloud Sync Controls */}
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <StudentAvatar name={user.name} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-foreground truncate" title={user.name}>
              {user.name}
            </p>
            <p className="text-[11px] text-muted truncate">
              {isCloudUser ? 'Cloud Firestore synced' : 'Local preview'} · {user.rollNumber}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {user.isDemo ? (
            <button
              type="button"
              onClick={handleResetWorkspace}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground whitespace-nowrap"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset binder</span>
            </button>
          ) : (
            <span className="text-[11px] font-mono text-primary">Firestore active</span>
          )}
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent whitespace-nowrap"
          >
            <LogOut className="w-3 h-3" />
            <span>Sign out</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col md:flex-row">
      {/* Desktop Collapsible Left Study Binder Rail */}
      {!sidebarCollapsed && (
        <aside
          aria-label="Student study binder and tools"
          className="hidden md:flex md:w-72 lg:w-76 shrink-0 border-r border-border bg-surface flex-col sticky top-0 h-dvh"
        >
          {renderSidebarContents()}
        </aside>
      )}

      {/* Mobile Drawer Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 md:hidden flex">
          <div
            className="fixed inset-0 bg-foreground/25"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 w-72 max-w-[85vw] bg-surface border-r border-border h-dvh">
            {renderSidebarContents()}
          </aside>
        </div>
      )}

      {/* Main Study Desk Column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Subtle Contextual Desk Bar with Student Avatar & Live Workspace Stats */}
        <header className="border-b border-border bg-surface/80 px-4 sm:px-8 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open study binder"
                className="md:hidden p-1.5 rounded-control border border-border text-foreground"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </button>

              {sidebarCollapsed && (
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(false)}
                  aria-label="Expand study binder"
                  className="hidden md:inline-flex p-1.5 rounded-control border border-border text-muted hover:text-foreground"
                >
                  <PanelLeftOpen className="w-4 h-4" />
                </button>
              )}

              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-editorial font-medium text-foreground truncate">
                  {activeTab === 'dashboard'
                    ? 'Personal study dashboard'
                    : activeDoc
                    ? activeDoc.title
                    : 'Student study desk'}
                </h1>
              </div>
            </div>

            {/* Student Profile, Theme Toggle & Workspace Stats */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <span className="hidden lg:inline tabular-nums">
                {workspace.documents.length}{' '}
                {workspace.documents.length === 1 ? 'document' : 'documents'} ·{' '}
                {totalChunks} chunks · {savedSummaryCount}{' '}
                {savedSummaryCount === 1 ? 'summary' : 'summaries'} · {savedQuizCount}{' '}
                {savedQuizCount === 1 ? 'quiz' : 'quizzes'}
              </span>

              <Button
                tone="quiet"
                onClick={() => setUploadOpen(true)}
                className="min-h-8 px-2.5 py-1 text-xs"
              >
                <Plus className="w-3.5 h-3.5 text-primary" />
                <span>Upload PDF</span>
              </Button>

              <button
                type="button"
                onClick={handleToggleTheme}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                className="inline-flex items-center gap-1.5 min-h-8 px-2.5 py-1 rounded-control border border-border bg-surface text-xs text-foreground hover:border-primary"
              >
                {theme === 'dark' ? (
                  <>
                    <Sun className="w-3.5 h-3.5 text-accent" />
                    <span className="hidden sm:inline">Light</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5 text-primary" />
                    <span className="hidden sm:inline">Dark</span>
                  </>
                )}
              </button>

              {user.isDemo && (
                <Button
                  tone="primary"
                  onClick={() => void handleUpgradeDemoToGoogle()}
                  className="min-h-8 px-2.5 py-1 text-xs"
                >
                  <span>Sign in with Google</span>
                </Button>
              )}

              <div className="flex items-center gap-2 pl-2 border-l border-border">
                <StudentAvatar name={user.name} size="sm" />
                <span className="text-foreground font-medium hidden sm:inline">
                  {user.name}
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Cloud Error Alert */}
        {cloudError && (
          <div
            role="alert"
            className="bg-surface border-b border-border px-4 sm:px-8 py-2 flex items-center justify-between gap-4 text-xs text-accent"
          >
            <span>{cloudError}</span>
            <button
              type="button"
              onClick={() => setCloudError(null)}
              className="text-muted hover:text-foreground whitespace-nowrap"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Status Feedback Line */}
        {statusBanner && (
          <div
            role="status"
            className="bg-surface border-b border-border px-4 sm:px-8 py-2 flex items-center justify-between gap-4 text-xs text-primary"
          >
            <span>{statusBanner}</span>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-muted hover:text-foreground whitespace-nowrap"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Spacious Reading, Doubt-Clearing & Revision Canvas */}
        <main className="flex-1 px-4 sm:px-8 py-6 sm:py-8 max-w-5xl w-full mx-auto">
          {activeTab === 'dashboard' && (
            <StudyDashboard
              user={user}
              workspace={workspace}
              onToggleTopicComplete={(docId) => void handleToggleTopicComplete(docId)}
              onChangeDailyGoal={(mins) => void handleChangeDailyGoal(mins)}
              onOpenDocumentTool={handleOpenDocumentTool}
              onOpenUpload={() => setUploadOpen(true)}
            />
          )}

          {activeTab === 'chat' && (
            <ChatCanvas
              activeDoc={activeDoc}
              allDocs={workspace.documents}
              messages={activeDoc ? workspace.messagesByDoc[activeDoc.id] ?? [] : []}
              onAppendMessages={(msgs) => void handleAppendMessages(msgs)}
              onClearHistory={() => void handleClearChat()}
              onHydrateDocChunks={(id, chunks) => void handleHydrateDocChunks(id, chunks)}
              onOpenUpload={() => setUploadOpen(true)}
              onLaunchComparison={handleLaunchComparisonFromChat}
            />
          )}

          {activeTab === 'summary' && (
            <SummaryView
              activeDoc={activeDoc}
              summary={activeDoc ? workspace.summariesByDoc[activeDoc.id] : undefined}
              onSaveSummary={(s) => void handleSaveSummary(s)}
              onOpenUpload={() => setUploadOpen(true)}
            />
          )}

          {activeTab === 'quiz' && (
            <QuizView
              activeDoc={activeDoc}
              quiz={activeDoc ? workspace.quizzesByDoc[activeDoc.id] : undefined}
              onSaveQuiz={(q) => void handleSaveQuiz(q)}
              onOpenUpload={() => setUploadOpen(true)}
            />
          )}

          {activeTab === 'compare' && (
            <ComparisonView
              activeDoc={activeDoc}
              comparisons={workspace.comparisons}
              pendingQuestion={pendingComparisonQuestion}
              onClearPendingQuestion={() => setPendingComparisonQuestion(null)}
              onSaveComparison={(r) => void handleSaveComparison(r)}
              onHydrateDocChunks={(id, chunks) => void handleHydrateDocChunks(id, chunks)}
              onOpenUpload={() => setUploadOpen(true)}
            />
          )}

          {activeTab === 'chunks' && (
            <ChunksInspectorView
              activeDoc={activeDoc}
              onOpenUpload={() => setUploadOpen(true)}
            />
          )}
        </main>
      </div>

      <UploadModal
        open={uploadOpen}
        userId={user.id}
        onClose={() => setUploadOpen(false)}
        onDocumentIndexed={(d) => void handleDocumentIndexed(d)}
      />
    </div>
  );
}
