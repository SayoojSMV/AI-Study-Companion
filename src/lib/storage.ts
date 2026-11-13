import {
  buildSeededStudyMetrics,
  createSeededWorkspace,
  createStarterWorkspaceForNewStudent,
  DEMO_STUDENT,
} from '../data/seedWorkspace';
import type { StudentUser, StudentWorkspaceData } from '../types';

const USERS_KEY = 'study_companion_users_v1';
const SESSION_KEY = 'study_companion_session_v1';
const WORKSPACE_PREFIX = 'study_companion_ws_v1_';

function safeReadJson<T>(storage: Storage, key: string, fallback: T): T {
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function safeWriteJson(storage: Storage, key: string, value: unknown): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors gracefully
  }
}

function simpleHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

export function getRegisteredUsers(): StudentUser[] {
  const stored = safeReadJson<StudentUser[]>(localStorage, USERS_KEY, []);
  if (!Array.isArray(stored) || stored.length === 0) {
    const initial: StudentUser[] = [
      {
        ...DEMO_STUDENT,
        passwordHash: simpleHash('demo1234'),
      },
    ];
    safeWriteJson(localStorage, USERS_KEY, initial);
    return initial;
  }
  return stored;
}

export function getCurrentSessionUser(): StudentUser | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw === 'SIGNED_OUT') {
      return null;
    }
    if (raw) {
      const parsed = JSON.parse(raw) as StudentUser;
      if (parsed && typeof parsed.id === 'string') {
        return parsed;
      }
    }
  } catch {
    // Fall through to default active student session
  }

  // Open immediately into the pre-populated student workspace on fresh load
  setSessionUser(DEMO_STUDENT);
  return DEMO_STUDENT;
}

export function setSessionUser(user: StudentUser | null): void {
  try {
    if (!user) {
      sessionStorage.setItem(SESSION_KEY, 'SIGNED_OUT');
    } else {
      const { passwordHash: _omit, ...publicUser } = user;
      void _omit;
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(publicUser));
    }
  } catch {
    // Ignore sessionStorage failure
  }
}

export function signInWithEmail(
  email: string,
  password: string
): { user?: StudentUser; error?: string } {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !password) {
    return { error: 'Enter both your university email and password.' };
  }

  const users = getRegisteredUsers();
  const match = users.find((u) => u.email.toLowerCase() === cleanEmail);
  if (!match) {
    return {
      error:
        'No student workspace found for that email. Create an account or continue as Demo Student.',
    };
  }

  if (match.passwordHash && match.passwordHash !== simpleHash(password)) {
    return { error: 'Incorrect password. Please check your credentials and try again.' };
  }

  setSessionUser(match);
  return { user: match };
}

export function registerStudentAccount(params: {
  name: string;
  email: string;
  password: string;
  program: string;
  rollNumber: string;
}): { user?: StudentUser; error?: string } {
  const name = params.name.trim();
  const email = params.email.trim().toLowerCase();
  const password = params.password;
  const program = params.program.trim() || 'B.Tech CSE · Sem VI';
  const rollNumber = params.rollNumber.trim() || `STU-${Math.floor(100 + Math.random() * 899)}`;

  if (name.length < 2) {
    return { error: 'Enter your full name (at least 2 characters).' };
  }
  if (!email.includes('@') || !email.includes('.')) {
    return { error: 'Enter a valid academic or personal email address.' };
  }
  if (password.length < 6) {
    return { error: 'Choose a password of at least 6 characters.' };
  }

  const users = getRegisteredUsers();
  if (users.some((u) => u.email.toLowerCase() === email)) {
    return { error: 'An account with this email already exists. Switch to Sign in.' };
  }

  const newUser: StudentUser = {
    id: `student-${Date.now().toString(36)}`,
    name,
    email,
    program,
    rollNumber,
    passwordHash: simpleHash(password),
    isDemo: false,
  };

  const updated = [...users, newUser];
  safeWriteJson(localStorage, USERS_KEY, updated);

  // Initialize isolated workspace for this student
  const starter = createStarterWorkspaceForNewStudent(newUser.id);
  saveWorkspaceData(newUser.id, starter);

  setSessionUser(newUser);
  return { user: newUser };
}

export function continueAsDemoStudent(): StudentUser {
  setSessionUser(DEMO_STUDENT);
  return DEMO_STUDENT;
}

export function loadWorkspaceData(user: StudentUser): StudentWorkspaceData {
  const key = `${WORKSPACE_PREFIX}${user.id}`;
  const existing = safeReadJson<StudentWorkspaceData | null>(localStorage, key, null);

  if (
    existing &&
    Array.isArray(existing.documents) &&
    typeof existing.messagesByDoc === 'object'
  ) {
    if (!existing.studyMetrics) {
      const hydrated: StudentWorkspaceData = {
        ...existing,
        studyMetrics: buildSeededStudyMetrics(
          existing.documents.map((d) => d.id),
          Boolean(user.isDemo)
        ),
      };
      saveWorkspaceData(user.id, hydrated);
      return hydrated;
    }
    return existing;
  }

  const initial = user.isDemo
    ? createSeededWorkspace(user.id)
    : createStarterWorkspaceForNewStudent(user.id);

  saveWorkspaceData(user.id, initial);
  return initial;
}

export function saveWorkspaceData(userId: string, data: StudentWorkspaceData): void {
  const key = `${WORKSPACE_PREFIX}${userId}`;
  safeWriteJson(localStorage, key, data);
}

export function resetWorkspaceToDefault(user: StudentUser): StudentWorkspaceData {
  const fresh = user.isDemo
    ? createSeededWorkspace(user.id)
    : createStarterWorkspaceForNewStudent(user.id);
  saveWorkspaceData(user.id, fresh);
  return fresh;
}

const THEME_KEY = 'study_companion_theme_v1';

export function loadThemePreference(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // Ignore storage read errors
  }
  return 'light';
}

export function saveThemePreference(theme: 'light' | 'dark'): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Ignore storage write errors
  }
}

