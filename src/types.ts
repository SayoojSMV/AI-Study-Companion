export interface StudentUser {
  id: string;
  name: string;
  email: string;
  program: string;
  rollNumber: string;
  passwordHash?: string;
  isDemo?: boolean;
}

export interface DocumentChunk {
  id: string;
  docId: string;
  docTitle: string;
  pageNumber: number;
  chunkIndex: number;
  sectionHeading?: string;
  text: string;
  charCount: number;
  overlapChars: number;
  localEmbedding: number[];
  geminiEmbedding?: number[];
}

export interface StudyDocument {
  id: string;
  userId: string;
  title: string;
  courseCode: string;
  fileName: string;
  uploadedAt: string;
  pageCount: number;
  totalChars: number;
  embeddingModel: string;
  embeddingDimensions: number;
  chunks: DocumentChunk[];
}

export interface CitationRef {
  chunkId: string;
  docTitle: string;
  pageNumber: number;
  chunkIndex: number;
  sectionHeading?: string;
  snippet: string;
  similarity: number;
}

export type TutorMode = 'rag' | 'clarifier';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  mode: TutorMode;
  content: string;
  timestamp: string;
  groundedInNotes?: boolean;
  primarySource?: 'uploaded_notes' | 'general_knowledge' | 'not_in_notes';
  provenanceSummary?: string;
  citations?: CitationRef[];
  vectorEngine?: string;
}

export interface RevisionSummary {
  id: string;
  docId: string;
  docTitle: string;
  createdAt: string;
  overview: string;
  keyPoints: Array<{ point: string; pageRef: string }>;
  formulas: Array<{
    name: string;
    expression: string;
    meaning: string;
    pageRef: string;
  }>;
  definitions: Array<{
    term: string;
    definition: string;
    pageRef: string;
  }>;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  pageRef: string;
  topic: string;
}

export interface SavedQuiz {
  id: string;
  docId: string;
  docTitle: string;
  createdAt: string;
  questions: QuizQuestion[];
  selectedAnswers: Record<number, number>;
  bestScore?: number;
}

export interface ComparisonRun {
  id: string;
  docId: string;
  docTitle: string;
  question: string;
  createdAt: string;
  ragAnswer: string;
  ragGrounded: boolean;
  citations: CitationRef[];
  standardAnswer: string;
  peakSimilarity: number;
  vectorEngine: string;
}

export interface StudyMetrics {
  dailyMinutes: Record<string, number>;
  minutesByDoc: Record<string, number>;
  completedDocIds: string[];
  dailyGoalMinutes: number;
}

export interface StudentWorkspaceData {
  documents: StudyDocument[];
  messagesByDoc: Record<string, ChatMessage[]>;
  summariesByDoc: Record<string, RevisionSummary>;
  quizzesByDoc: Record<string, SavedQuiz>;
  comparisons: ComparisonRun[];
  studyMetrics: StudyMetrics;
}

export type WorkspaceTab =
  | 'dashboard'
  | 'chat'
  | 'summary'
  | 'quiz'
  | 'compare'
  | 'chunks';
