import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { createStarterWorkspaceForNewStudent } from '../data/seedWorkspace';
import type {
  ChatMessage,
  ComparisonRun,
  DocumentChunk,
  RevisionSummary,
  SavedQuiz,
  StudentUser,
  StudentWorkspaceData,
  StudyDocument,
} from '../types';
import { db, handleFirestoreError, OperationType } from './firebase';

function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_\-]+/g, '-').slice(0, 120);
  return cleaned || `id-${Date.now()}`;
}

function clampString(val: string, maxLen: number): string {
  return val.length > maxLen ? val.slice(0, maxLen) : val;
}

export async function ensureStudentProfileInFirestore(
  firebaseUser: User
): Promise<StudentUser> {
  const uid = firebaseUser.uid;
  const userRef = doc(db, 'users', uid);
  const path = `users/${uid}`;

  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data();
      return {
        id: uid,
        name: String(data.name || firebaseUser.displayName || 'Student'),
        email: String(data.email || firebaseUser.email || ''),
        program: String(data.program || 'B.Tech AIML · Sem VII'),
        rollNumber: String(data.rollNumber || `STU-${uid.slice(0, 6).toUpperCase()}`),
        isDemo: false,
      };
    }

    const profile: StudentUser = {
      id: uid,
      name: clampString(firebaseUser.displayName || 'Student Scholar', 120),
      email: clampString(firebaseUser.email || '', 254),
      program: 'B.Tech AIML · Sem VII',
      rollNumber: `STU-${uid.slice(0, 6).toUpperCase()}`,
      isDemo: false,
    };

    await setDoc(userRef, {
      uid,
      name: profile.name,
      email: profile.email,
      program: profile.program,
      rollNumber: profile.rollNumber,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Seed starter course material into Firestore on first sign-in
    const starter = createStarterWorkspaceForNewStudent(uid);
    for (const starterDoc of starter.documents) {
      await saveDocumentToFirestore(uid, starterDoc);
    }

    return profile;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function fetchStudentWorkspaceFromFirestore(
  uid: string
): Promise<StudentWorkspaceData> {
  const docsPath = `users/${uid}/documents`;
  const documents: StudyDocument[] = [];
  const messagesByDoc: Record<string, ChatMessage[]> = {};
  const summariesByDoc: Record<string, RevisionSummary> = {};
  const quizzesByDoc: Record<string, SavedQuiz> = {};

  try {
    const docsQuery = query(
      collection(db, docsPath),
      where('ownerId', '==', uid),
      orderBy('createdAt', 'desc')
    );
    const docsSnap = await getDocs(docsQuery);

    for (const docSnap of docsSnap.docs) {
      const d = docSnap.data();
      const docId = docSnap.id;

      // Load chunks subcollection
      const chunksPath = `users/${uid}/documents/${docId}/chunks`;
      const chunksSnap = await getDocs(
        query(collection(db, chunksPath), where('ownerId', '==', uid), orderBy('chunkIndex', 'asc'))
      );
      const chunks: DocumentChunk[] = chunksSnap.docs.map((cSnap) => {
        const c = cSnap.data();
        return {
          id: cSnap.id,
          docId,
          docTitle: String(c.docTitle || d.title),
          pageNumber: Number(c.pageNumber || 1),
          chunkIndex: Number(c.chunkIndex || 1),
          sectionHeading: c.sectionHeading ? String(c.sectionHeading) : undefined,
          text: String(c.text || ''),
          charCount: Number(c.charCount || 0),
          overlapChars: Number(c.overlapChars || 0),
          localEmbedding: Array.isArray(c.localEmbedding) ? (c.localEmbedding as number[]) : [],
          geminiEmbedding: Array.isArray(c.geminiEmbedding)
            ? (c.geminiEmbedding as number[])
            : undefined,
        };
      });

      documents.push({
        id: docId,
        userId: uid,
        title: String(d.title || 'Untitled Notes'),
        courseCode: String(d.courseCode || 'COURSE'),
        fileName: String(d.fileName || 'notes.txt'),
        uploadedAt: String(d.uploadedAt || 'Today'),
        pageCount: Number(d.pageCount || 1),
        totalChars: Number(d.totalChars || 0),
        embeddingModel: String(d.embeddingModel || 'gemini-embedding-2'),
        embeddingDimensions: Number(d.embeddingDimensions || 256),
        chunks,
      });

      // Load messages subcollection
      const msgsPath = `users/${uid}/documents/${docId}/messages`;
      const msgsSnap = await getDocs(
        query(collection(db, msgsPath), where('ownerId', '==', uid), orderBy('createdAt', 'asc'))
      );
      messagesByDoc[docId] = msgsSnap.docs.map((mSnap) => {
        const m = mSnap.data();
        return {
          id: mSnap.id,
          role: m.role === 'user' ? 'user' : 'assistant',
          mode: m.mode === 'clarifier' ? 'clarifier' : 'rag',
          content: String(m.content || ''),
          timestamp: String(m.timestampLabel || ''),
          groundedInNotes:
            typeof m.groundedInNotes === 'boolean' ? m.groundedInNotes : undefined,
          primarySource: m.primarySource,
          provenanceSummary: m.provenanceSummary ? String(m.provenanceSummary) : undefined,
          citations: Array.isArray(m.citations) ? m.citations : undefined,
          vectorEngine: m.vectorEngine ? String(m.vectorEngine) : undefined,
        };
      });

      // Load summary subcollection
      const sumPath = `users/${uid}/documents/${docId}/summaries`;
      const sumSnap = await getDocs(query(collection(db, sumPath), where('ownerId', '==', uid)));
      if (!sumSnap.empty) {
        const sDoc = sumSnap.docs[0];
        const s = sDoc.data();
        summariesByDoc[docId] = {
          id: sDoc.id,
          docId,
          docTitle: String(s.docTitle || d.title),
          createdAt: String(s.createdAtLabel || ''),
          overview: String(s.overview || ''),
          keyPoints: Array.isArray(s.keyPoints) ? s.keyPoints : [],
          formulas: Array.isArray(s.formulas) ? s.formulas : [],
          definitions: Array.isArray(s.definitions) ? s.definitions : [],
        };
      }

      // Load quiz subcollection
      const quizPath = `users/${uid}/documents/${docId}/quizzes`;
      const quizSnap = await getDocs(query(collection(db, quizPath), where('ownerId', '==', uid)));
      if (!quizSnap.empty) {
        const qDoc = quizSnap.docs[0];
        const q = qDoc.data();
        const rawAnswers = (q.selectedAnswers || {}) as Record<string, number>;
        const selectedAnswers: Record<number, number> = {};
        for (const [k, v] of Object.entries(rawAnswers)) {
          selectedAnswers[Number(k)] = Number(v);
        }
        quizzesByDoc[docId] = {
          id: qDoc.id,
          docId,
          docTitle: String(q.docTitle || d.title),
          createdAt: String(q.createdAtLabel || ''),
          questions: Array.isArray(q.questions) ? q.questions : [],
          selectedAnswers,
          bestScore: typeof q.bestScore === 'number' ? q.bestScore : undefined,
        };
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, docsPath);
  }

  const comparisonsPath = `users/${uid}/comparisons`;
  const comparisons: ComparisonRun[] = [];
  try {
    const compSnap = await getDocs(
      query(collection(db, comparisonsPath), where('ownerId', '==', uid), orderBy('createdAt', 'desc'))
    );
    for (const cSnap of compSnap.docs) {
      const c = cSnap.data();
      comparisons.push({
        id: cSnap.id,
        docId: String(c.docId || ''),
        docTitle: String(c.docTitle || ''),
        question: String(c.question || ''),
        createdAt: String(c.createdAtLabel || ''),
        ragAnswer: String(c.ragAnswer || ''),
        ragGrounded: Boolean(c.ragGrounded),
        citations: Array.isArray(c.citations) ? c.citations : [],
        standardAnswer: String(c.standardAnswer || ''),
        peakSimilarity: Number(c.peakSimilarity || 0),
        vectorEngine: String(c.vectorEngine || 'gemini-embedding-2'),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, comparisonsPath);
  }

  return {
    documents,
    messagesByDoc,
    summariesByDoc,
    quizzesByDoc,
    comparisons,
  };
}

export async function saveDocumentToFirestore(
  uid: string,
  studyDoc: StudyDocument
): Promise<void> {
  const docId = sanitizeId(studyDoc.id);
  const docPath = `users/${uid}/documents/${docId}`;

  try {
    await setDoc(doc(db, docPath), {
      ownerId: uid,
      title: clampString(studyDoc.title, 200),
      courseCode: clampString(studyDoc.courseCode, 32),
      fileName: clampString(studyDoc.fileName, 240),
      uploadedAt: clampString(studyDoc.uploadedAt, 64),
      pageCount: Math.max(1, Math.round(studyDoc.pageCount)),
      totalChars: Math.max(1, Math.round(studyDoc.totalChars)),
      chunkCount: Math.max(1, studyDoc.chunks.length),
      embeddingModel: clampString(studyDoc.embeddingModel, 80),
      embeddingDimensions: Math.max(1, Math.round(studyDoc.embeddingDimensions)),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Commit chunks in batches of 200 to stay well under Firestore batch limits
    const chunks = studyDoc.chunks;
    for (let i = 0; i < chunks.length; i += 200) {
      const batch = writeBatch(db);
      const slice = chunks.slice(i, i + 200);
      for (const ch of slice) {
        const chunkId = sanitizeId(ch.id);
        const chunkRef = doc(db, `users/${uid}/documents/${docId}/chunks/${chunkId}`);
        const payload: Record<string, unknown> = {
          ownerId: uid,
          docId,
          docTitle: clampString(studyDoc.title, 200),
          pageNumber: Math.max(1, Math.round(ch.pageNumber)),
          chunkIndex: Math.max(1, Math.round(ch.chunkIndex)),
          text: clampString(ch.text, 4000),
          charCount: Math.max(1, Math.min(4000, ch.charCount)),
          overlapChars: Math.max(0, Math.min(1000, ch.overlapChars)),
          localEmbedding: ch.localEmbedding.slice(0, 512),
          createdAt: serverTimestamp(),
        };
        if (ch.sectionHeading && ch.sectionHeading.trim()) {
          payload.sectionHeading = clampString(ch.sectionHeading.trim(), 200);
        }
        if (ch.geminiEmbedding && ch.geminiEmbedding.length > 0) {
          payload.geminiEmbedding = ch.geminiEmbedding.slice(0, 3072);
        }
        batch.set(chunkRef, payload);
      }
      await batch.commit();
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, docPath);
  }
}

export async function updateChunkEmbeddingsInFirestore(
  uid: string,
  docId: string,
  chunks: DocumentChunk[],
  model: string,
  dimensions: number
): Promise<void> {
  const safeDocId = sanitizeId(docId);
  const docPath = `users/${uid}/documents/${safeDocId}`;

  try {
    await updateDoc(doc(db, docPath), {
      embeddingModel: clampString(model, 80),
      embeddingDimensions: Math.max(1, Math.round(dimensions)),
      updatedAt: serverTimestamp(),
    });

    for (let i = 0; i < chunks.length; i += 200) {
      const batch = writeBatch(db);
      const slice = chunks.slice(i, i + 200);
      for (const ch of slice) {
        if (!ch.geminiEmbedding || ch.geminiEmbedding.length === 0) continue;
        const chunkId = sanitizeId(ch.id);
        const chunkRef = doc(db, `users/${uid}/documents/${safeDocId}/chunks/${chunkId}`);
        batch.update(chunkRef, {
          geminiEmbedding: ch.geminiEmbedding.slice(0, 3072),
        });
      }
      await batch.commit();
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, docPath);
  }
}

export async function deleteDocumentFromFirestore(
  uid: string,
  docId: string
): Promise<void> {
  const safeDocId = sanitizeId(docId);
  const docPath = `users/${uid}/documents/${safeDocId}`;

  try {
    // Delete child subcollections first
    const subcollections = ['chunks', 'messages', 'summaries', 'quizzes'];
    for (const sub of subcollections) {
      const subPath = `${docPath}/${sub}`;
      const snap = await getDocs(query(collection(db, subPath), where('ownerId', '==', uid)));
      for (let i = 0; i < snap.docs.length; i += 300) {
        const batch = writeBatch(db);
        snap.docs.slice(i, i + 300).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    }

    await deleteDoc(doc(db, docPath));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, docPath);
  }
}

export async function appendMessagesToFirestore(
  uid: string,
  docId: string,
  messages: ChatMessage[]
): Promise<void> {
  const safeDocId = sanitizeId(docId);
  const basePath = `users/${uid}/documents/${safeDocId}/messages`;

  try {
    const batch = writeBatch(db);
    for (const msg of messages) {
      const msgId = sanitizeId(msg.id);
      const msgRef = doc(db, `${basePath}/${msgId}`);
      const payload: Record<string, unknown> = {
        ownerId: uid,
        docId: safeDocId,
        role: msg.role,
        mode: msg.mode,
        content: clampString(msg.content, 12000),
        timestampLabel: clampString(msg.timestamp || 'Now', 32),
        createdAt: serverTimestamp(),
      };
      if (typeof msg.groundedInNotes === 'boolean') {
        payload.groundedInNotes = msg.groundedInNotes;
      }
      if (msg.primarySource) {
        payload.primarySource = msg.primarySource;
      }
      if (msg.provenanceSummary) {
        payload.provenanceSummary = clampString(msg.provenanceSummary, 500);
      }
      if (msg.citations && msg.citations.length > 0) {
        payload.citations = msg.citations.slice(0, 8);
      }
      if (msg.vectorEngine) {
        payload.vectorEngine = clampString(msg.vectorEngine, 64);
      }
      batch.set(msgRef, payload);
    }
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, basePath);
  }
}

export async function clearMessagesInFirestore(
  uid: string,
  docId: string
): Promise<void> {
  const safeDocId = sanitizeId(docId);
  const basePath = `users/${uid}/documents/${safeDocId}/messages`;
  try {
    const snap = await getDocs(query(collection(db, basePath), where('ownerId', '==', uid)));
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, basePath);
  }
}

export async function saveSummaryToFirestore(
  uid: string,
  summary: RevisionSummary
): Promise<void> {
  const safeDocId = sanitizeId(summary.docId);
  const summaryId = 'latest';
  const sumPath = `users/${uid}/documents/${safeDocId}/summaries/${summaryId}`;

  try {
    const existing = await getDoc(doc(db, sumPath));
    if (existing.exists()) {
      await updateDoc(doc(db, sumPath), {
        createdAtLabel: clampString(summary.createdAt, 64),
        overview: clampString(summary.overview, 4000),
        keyPoints: summary.keyPoints.slice(0, 30),
        formulas: summary.formulas.slice(0, 20),
        definitions: summary.definitions.slice(0, 30),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, sumPath), {
        ownerId: uid,
        docId: safeDocId,
        docTitle: clampString(summary.docTitle, 200),
        createdAtLabel: clampString(summary.createdAt, 64),
        overview: clampString(summary.overview, 4000),
        keyPoints: summary.keyPoints.slice(0, 30),
        formulas: summary.formulas.slice(0, 20),
        definitions: summary.definitions.slice(0, 30),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, sumPath);
  }
}

export async function saveQuizToFirestore(
  uid: string,
  quiz: SavedQuiz
): Promise<void> {
  const safeDocId = sanitizeId(quiz.docId);
  const quizId = 'latest';
  const quizPath = `users/${uid}/documents/${safeDocId}/quizzes/${quizId}`;

  const stringKeyedAnswers: Record<string, number> = {};
  for (const [k, v] of Object.entries(quiz.selectedAnswers)) {
    stringKeyedAnswers[String(k)] = v;
  }

  try {
    const existing = await getDoc(doc(db, quizPath));
    if (existing.exists()) {
      const updatePayload: Record<string, unknown> = {
        createdAtLabel: clampString(quiz.createdAt, 64),
        questions: quiz.questions.slice(0, 10),
        selectedAnswers: stringKeyedAnswers,
        updatedAt: serverTimestamp(),
      };
      if (typeof quiz.bestScore === 'number') {
        updatePayload.bestScore = Math.max(0, Math.min(100, quiz.bestScore));
      }
      await updateDoc(doc(db, quizPath), updatePayload);
    } else {
      const createPayload: Record<string, unknown> = {
        ownerId: uid,
        docId: safeDocId,
        docTitle: clampString(quiz.docTitle, 200),
        createdAtLabel: clampString(quiz.createdAt, 64),
        questions: quiz.questions.slice(0, 10),
        selectedAnswers: stringKeyedAnswers,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (typeof quiz.bestScore === 'number') {
        createPayload.bestScore = Math.max(0, Math.min(100, quiz.bestScore));
      }
      await setDoc(doc(db, quizPath), createPayload);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, quizPath);
  }
}

export async function saveComparisonToFirestore(
  uid: string,
  run: ComparisonRun
): Promise<void> {
  const compId = sanitizeId(run.id);
  const compPath = `users/${uid}/comparisons/${compId}`;

  try {
    await setDoc(doc(db, compPath), {
      ownerId: uid,
      docId: sanitizeId(run.docId),
      docTitle: clampString(run.docTitle, 200),
      question: clampString(run.question, 2000),
      createdAtLabel: clampString(run.createdAt, 64),
      ragAnswer: clampString(run.ragAnswer, 12000),
      ragGrounded: Boolean(run.ragGrounded),
      citations: run.citations.slice(0, 8),
      standardAnswer: clampString(run.standardAnswer, 12000),
      peakSimilarity: Math.max(-1, Math.min(1, run.peakSimilarity)),
      vectorEngine: clampString(run.vectorEngine, 64),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, compPath);
  }
}
