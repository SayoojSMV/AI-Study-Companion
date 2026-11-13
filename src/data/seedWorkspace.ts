import {
  computeDeterministicEmbedding,
  splitIntoOverlappingChunks,
  type RawPageText,
} from '../model/vectorMath';
import type {
  DocumentChunk,
  StudentUser,
  StudentWorkspaceData,
  StudyDocument,
} from '../types';

export const DEMO_STUDENT: StudentUser = {
  id: 'student-ananya-r22cs108',
  name: 'Ananya Rao',
  email: 'ananya.rao@university.edu',
  program: 'B.Tech AIML · Sem VII',
  rollNumber: 'R22CS108',
  isDemo: true,
};

const LECTURE_07_PAGES: RawPageText[] = [
  {
    pageNumber: 1,
    text: `Lecture 07: Bias-Variance Decomposition and Penalized Risk Minimization
Course: CS-402 Statistical Machine Learning · Faculty Guide: Dr. Shashikala N

1.1 Expected Prediction Error Decomposition
Given an unknown target relation y = f(x) + ε where noise ε has zero mean E[ε] = 0 and irreducible variance Var(ε) = σ_ε², we evaluate an estimator f̂(x) trained over random dataset draws D. At any test point x₀, the expected squared prediction error decomposes into three non-negative terms:
E_D[(y - f̂(x₀))²] = Bias_D[f̂(x₀)]² + Var_D[f̂(x₀)] + σ_ε².

Here Bias_D[f̂(x₀)] = E_D[f̂(x₀)] - f(x₀) measures systematic structural underfitting, while Var_D[f̂(x₀)] = E_D[(f̂(x₀) - E_D[f̂(x₀)])²] quantifies sensitivity to finite-sample fluctuations in the training set D. Unconstrained high-degree polynomial or over-parameterized linear models achieve near-zero training bias at the expense of severe estimator variance when features are collinear.`,
  },
  {
    pageNumber: 2,
    text: `1.2 Ridge (L₂) Shrinkage and Collinearity Stabilization
Ridge regression augments ordinary least squares with a quadratic Tikhonov penalty controlled by hyperparameter λ ≥ 0:
J_Ridge(w) = (1 / 2n) ||y - Xw||₂² + (λ / 2) ||w||₂².

Note that the intercept bias term w₀ is never penalized so predictions remain shift-equivariant with respect to target centering. Taking the gradient ∇_w J_Ridge(w) = 0 yields the closed-form analytical estimator:
ŵ_Ridge = (XᵀX + nλI)⁻¹ Xᵀy.

Adding nλI shifts every eigenvalue μ_j of the sample covariance matrix XᵀX to (μ_j + nλ), guaranteeing invertibility even when p > n or when predictors exhibit strong multicollinearity. Along principal directions with small variance μ_j, Ridge shrinks coordinates aggressively by the factor μ_j / (μ_j + nλ), trading a modest increase in squared bias for a substantial drop in estimator variance.`,
  },
  {
    pageNumber: 3,
    text: `1.3 Lasso (L₁) Sparsity and the Soft-Thresholding Operator
Unlike L₂ regularization, the Lasso objective replaces the squared norm with the non-differentiable L₁ norm:
J_Lasso(w) = (1 / 2n) ||y - Xw||₂² + λ ||w||₁.

Because the L₁ constraint region ||w||₁ ≤ t forms a cross-polytope with sharp vertices aligned along coordinate axes, elliptical loss contours frequently intersect vertices first, driving irrelevant feature weights to exact zero. Under an orthonormal design where XᵀX / n = I, coordinate descent admits an exact closed-form proximal update via the soft-thresholding operator S_λ(z):
ŵ_j^Lasso = S_λ(ŵ_j^OLS) = sign(ŵ_j^OLS) · max(|ŵ_j^OLS| - λ, 0).

Any ordinary least squares coefficient with magnitude |ŵ_j^OLS| ≤ λ is zeroed out completely, whereas surviving coefficients are shrunk toward zero by a constant offset λ.`,
  },
  {
    pageNumber: 4,
    text: `1.4 CS-402 Lab 3 Rubric: Modified Huber-Ridge Protocol
For CS-402 Lab 3 submissions on noisy sensor benchmarks, standard ordinary Ridge regression is prohibited because heavy-tailed outliers corrupt squared residuals. All CS-402 student implementations must use the course-specific Sample-Adjusted Huber-Ridge estimator with the following mandatory configuration:
1. Validation Split Protocol: Nested 5×3 stratified cross-validation (5 outer test folds for unbiased risk reporting, 3 inner folds for hyperparameter selection). Simple 80/20 holdout splits receive a 4-point rubric deduction.
2. Huber Transition Threshold: Set δ = 1.35 · σ̂_MAD, where σ̂_MAD = 1.4826 · median(|r_i - median(r)|) is computed strictly on the inner training fold residuals—never on test folds to prevent data leakage.
3. Sample-Adjusted Effective Penalty: Scale base candidate penalties λ₀ ∈ {0.01, 0.1, 1.0, 10.0} using the effective validation-adjusted formula λ_eff = λ₀ / √n_val, where n_val is the inner validation fold sample count.`,
  },
];

const LECTURE_11_PAGES: RawPageText[] = [
  {
    pageNumber: 1,
    text: `Lecture 11: Scaled Dot-Product Attention and Retrieval-Augmented Generation
Course: CS-402 Statistical Machine Learning · Center for AI & Machine Learning

2.1 Scaled Dot-Product Self-Attention
Given packed query, key, and value projections Q ∈ R^(T×d_k), K ∈ R^(T×d_k), and V ∈ R^(T×d_v), the Transformer self-attention layer computes contextual token representations as:
Attention(Q, K, V) = softmax( (Q Kᵀ) / √d_k ) V.

Why divide by √d_k? Suppose entries of query q and key k are independent random variables with mean 0 and unit variance 1. Their unscaled dot product q · k = ∑_{i=1}^{d_k} q_i k_i has mean 0 and variance d_k. For large head dimension d_k (such as d_k = 64 or 128), dot products grow large in magnitude, pushing the softmax function into saturated regions where gradients approach zero. Scaling by 1 / √d_k restores unit variance Var((q · k)/√d_k) = 1 before applying softmax.`,
  },
  {
    pageNumber: 2,
    text: `2.2 Dense Bi-Encoder Indexing and Cosine Similarity
Retrieval-Augmented Generation (RAG) decouples parametric reasoning from non-parametric course memory. During ingestion, documents are partitioned into overlapping passages c_1, ..., c_M and mapped into dense vector embeddings e_i = E_doc(c_i) ∈ R^d. At query time, a student question q is embedded into e_q = E_query(q) ∈ R^d, and relevance is scored via cosine similarity:
sim(e_q, e_i) = (e_q · e_i) / (||e_q||₂ ||e_i||₂).

When all stored document vectors and query vectors are L₂-normalized to unit length (||e||₂ = 1), cosine similarity reduces directly to an inner product e_qᵀ e_i, and maximizing cosine similarity becomes mathematically equivalent to minimizing squared Euclidean distance since ||e_q - e_i||₂² = 2 - 2(e_q · e_i).`,
  },
  {
    pageNumber: 3,
    text: `2.3 Chunking Granularity, Sliding Overlap, and Context Faithfulness
Chunking strategy governs retrieval precision vs. recall. Overly coarse chunks (e.g., > 2,500 characters) dilute topic-specific embeddings with unrelated paragraphs, lowering cosine discrimination. Overly narrow chunks (< 180 characters) sever mathematical definitions from their variable explanations or boundary assumptions.

In CS-402 project benchmarks, the recommended baseline pipeline uses sentence-aware chunks of 600–700 characters with an approximate 18%–20% sliding character overlap (~120–135 characters). Furthermore, responsible grounded prompting requires an explicit abstention rule: when peak retrieval similarity falls below relevance or retrieved passages omit the queried fact, the generator must abstain rather than extrapolate from ungrounded pre-training weights.`,
  },
];

function buildSeedDocument(params: {
  id: string;
  userId: string;
  title: string;
  courseCode: string;
  fileName: string;
  uploadedAt: string;
  pages: RawPageText[];
}): StudyDocument {
  const rawChunks = splitIntoOverlappingChunks(params.pages, 660, 125);
  const chunks: DocumentChunk[] = rawChunks.map((rc) => ({
    id: `${params.id}-chunk-${rc.chunkIndex}`,
    docId: params.id,
    docTitle: params.title,
    pageNumber: rc.pageNumber,
    chunkIndex: rc.chunkIndex,
    sectionHeading: rc.sectionHeading,
    text: rc.text,
    charCount: rc.charCount,
    overlapChars: rc.overlapChars,
    localEmbedding: computeDeterministicEmbedding(rc.text),
  }));

  const totalChars = params.pages.reduce((sum, p) => sum + p.text.length, 0);

  return {
    id: params.id,
    userId: params.userId,
    title: params.title,
    courseCode: params.courseCode,
    fileName: params.fileName,
    uploadedAt: params.uploadedAt,
    pageCount: params.pages.length,
    totalChars,
    embeddingModel: 'gemini-embedding-2',
    embeddingDimensions: 256,
    chunks,
  };
}

export function createSeededWorkspace(userId: string): StudentWorkspaceData {
  const doc1 = buildSeedDocument({
    id: `doc-lec07-${userId}`,
    userId,
    title: 'Lecture 07: Regularization, Bias-Variance & Lab 3 Rubric',
    courseCode: 'CS-402',
    fileName: 'CS402_Lecture07_Regularization_Lab3.pdf',
    uploadedAt: 'Nov 10, 2026',
    pages: LECTURE_07_PAGES,
  });

  const doc2 = buildSeedDocument({
    id: `doc-lec11-${userId}`,
    userId,
    title: 'Lecture 11: Scaled Attention & Dense RAG Retrieval',
    courseCode: 'CS-402',
    fileName: 'CS402_Lecture11_Attention_and_RAG.pdf',
    uploadedAt: 'Nov 12, 2026',
    pages: LECTURE_11_PAGES,
  });

  const labChunk = doc1.chunks[doc1.chunks.length - 1];
  const ridgeChunk = doc1.chunks.find((c) => c.pageNumber === 2) ?? doc1.chunks[1];

  return {
    documents: [doc1, doc2],
    messagesByDoc: {
      [doc1.id]: [
        {
          id: 'seed-msg-1',
          role: 'user',
          mode: 'rag',
          content:
            'What cross-validation split and effective penalty formula are mandatory for CS-402 Lab 3?',
          timestamp: '09:14 AM',
        },
        {
          id: 'seed-msg-2',
          role: 'assistant',
          mode: 'rag',
          content:
            `According to the CS-402 Lab 3 Rubric in your uploaded lecture notes, standard ordinary Ridge regression is prohibited on noisy sensor benchmarks [p. 4, Chunk #${labChunk.chunkIndex}]. Your implementation must satisfy three mandatory rules:\n\n` +
            `• Validation protocol: Nested 5×3 stratified cross-validation (5 outer test folds for risk reporting and 3 inner folds for hyperparameter tuning). Using a simple 80/20 holdout split incurs a 4-point rubric deduction [p. 4, Chunk #${labChunk.chunkIndex}].\n` +
            `• Huber threshold without leakage: Set δ = 1.35 · σ̂_MAD where σ̂_MAD = 1.4826 · median(|r_i − median(r)|) is estimated strictly on inner training fold residuals [p. 4, Chunk #${labChunk.chunkIndex}].\n` +
            `• Sample-adjusted effective penalty: Scale candidate values λ₀ ∈ {0.01, 0.1, 1.0, 10.0} via λ_eff = λ₀ / √n_val, where n_val is the inner validation fold sample size [p. 4, Chunk #${labChunk.chunkIndex}].`,
          timestamp: '09:14 AM',
          groundedInNotes: true,
          primarySource: 'uploaded_notes',
          vectorEngine: 'gemini-embedding-2',
          citations: [
            {
              chunkId: labChunk.id,
              docTitle: doc1.title,
              pageNumber: labChunk.pageNumber,
              chunkIndex: labChunk.chunkIndex,
              sectionHeading: labChunk.sectionHeading,
              snippet: labChunk.text,
              similarity: 0.892,
            },
            {
              chunkId: ridgeChunk.id,
              docTitle: doc1.title,
              pageNumber: ridgeChunk.pageNumber,
              chunkIndex: ridgeChunk.chunkIndex,
              sectionHeading: ridgeChunk.sectionHeading,
              snippet: ridgeChunk.text,
              similarity: 0.614,
            },
          ],
        },
      ],
      [doc2.id]: [],
    },
    summariesByDoc: {
      [doc1.id]: {
        id: `sum-${doc1.id}`,
        docId: doc1.id,
        docTitle: doc1.title,
        createdAt: 'Nov 12, 2026',
        overview:
          'Decomposes expected squared test error into squared bias, estimator variance, and irreducible noise, then contrasts L₂ (Ridge) eigenvalue stabilization against L₁ (Lasso) sparse feature selection and defines the mandatory CS-402 Lab 3 Huber-Ridge protocol.',
        keyPoints: [
          {
            point:
              'Unconstrained complex estimators lower structural bias but inflate sensitivity Var_D[f̂(x₀)] under collinearity.',
            pageRef: 'p. 1',
          },
          {
            point:
              'Ridge adds nλI before matrix inversion, shifting covariance eigenvalues to (μ_j + nλ) while leaving intercept w₀ unpenalized.',
            pageRef: 'p. 2',
          },
          {
            point:
              'Lasso uses an L₁ cross-polytope geometry whose soft-thresholding operator zeroes out any orthonormal OLS weight with |ŵ_j| ≤ λ.',
            pageRef: 'p. 3',
          },
          {
            point:
              'CS-402 Lab 3 requires nested 5×3 stratified CV (avoiding the 4-point 80/20 split deduction) and inner-fold σ̂_MAD scaling.',
            pageRef: 'p. 4',
          },
        ],
        formulas: [
          {
            name: 'Expected Prediction Error',
            expression: 'E_D[(y − f̂(x₀))²] = Bias_D[f̂(x₀)]² + Var_D[f̂(x₀)] + σ_ε²',
            meaning: 'Separates reducible structural bias and sample variance from irreducible noise variance σ_ε².',
            pageRef: 'p. 1',
          },
          {
            name: 'Closed-Form Ridge Estimator',
            expression: 'ŵ_Ridge = (XᵀX + nλI)⁻¹ Xᵀy',
            meaning: 'Stabilizes matrix inversion and shrinks low-variance principal directions by μ_j / (μ_j + nλ).',
            pageRef: 'p. 2',
          },
          {
            name: 'Lasso Soft-Thresholding Operator',
            expression: 'S_λ(ŵ_j) = sign(ŵ_j) · max(|ŵ_j| − λ, 0)',
            meaning: 'Produces exact coordinate sparsity under orthonormal design when |ŵ_j| ≤ λ.',
            pageRef: 'p. 3',
          },
          {
            name: 'CS-402 Lab 3 Effective Penalty',
            expression: 'λ_eff = λ₀ / √n_val   with   δ = 1.35 · σ̂_MAD',
            meaning: 'Course-mandated validation-scaled Huber-Ridge penalty computed without test-fold leakage.',
            pageRef: 'p. 4',
          },
        ],
        definitions: [
          {
            term: 'Irreducible Noise (σ_ε²)',
            definition:
              'Inherent variance of observation noise ε that no learning algorithm can eliminate regardless of capacity.',
            pageRef: 'p. 1',
          },
          {
            term: 'Tikhonov (L₂) Shrinkage',
            definition:
              'Continuous quadratic weight penalty that dampens collinear coefficient explosion without producing exact zeros.',
            pageRef: 'p. 2',
          },
          {
            term: 'Median Absolute Deviation (σ̂_MAD)',
            definition:
              'Robust scale estimator 1.4826 · median(|r_i − median(r)|) used on inner training residuals to set Huber δ.',
            pageRef: 'p. 4',
          },
        ],
      },
    },
    quizzesByDoc: {
      [doc1.id]: {
        id: `quiz-${doc1.id}`,
        docId: doc1.id,
        docTitle: doc1.title,
        createdAt: 'Nov 12, 2026',
        selectedAnswers: {},
        questions: [
          {
            topic: 'Ridge Eigenvalue Stabilization',
            question:
              'How does the closed-form Ridge estimator modify the eigenvalues μ_j of XᵀX, and why is w₀ excluded from the penalty?',
            options: [
              'Shifts eigenvalues to (μ_j + nλ) to ensure invertibility; w₀ is unpenalized to preserve target shift-equivariance.',
              'Multiplies eigenvalues by λ² and penalizes w₀ to center input predictors.',
              'Thresholds eigenvalues below λ to zero; w₀ is dropped because X is orthonormal.',
              'Subtracts nλ from each eigenvalue to eliminate estimator bias.',
            ],
            correctIndex: 0,
            explanation:
              'Adding nλI transforms each eigenvalue μ_j into (μ_j + nλ) > 0 for λ > 0, and leaving w₀ unpenalized ensures adding a constant offset to y simply shifts w₀ without distorting feature slopes.',
            pageRef: 'p. 2',
          },
          {
            topic: 'Orthonormal Lasso Sparsity',
            question:
              'Under an orthonormal design (XᵀX / n = I), if ŵ_j^OLS = −0.42 and λ = 0.50, what is the Lasso coordinate estimate ŵ_j^Lasso?',
            options: ['−0.92', '−0.08', '0', '+0.08'],
            correctIndex: 2,
            explanation:
              'By the soft-thresholding operator S_λ(z) = sign(z)·max(|z| − λ, 0), since |−0.42| = 0.42 ≤ 0.50, max(0.42 − 0.50, 0) = 0.',
            pageRef: 'p. 3',
          },
          {
            topic: 'CS-402 Lab 3 Rubric',
            question:
              'Which cross-validation protocol and effective penalty scaling are required for CS-402 Lab 3 noisy sensor submissions?',
            options: [
              'Standard 80/20 holdout split with λ_eff = λ₀ · n_val',
              'Nested 5×3 stratified cross-validation with λ_eff = λ₀ / √n_val',
              '10-fold leave-one-out CV with δ = 2.5 · σ_OLS',
              '5-fold unstratified CV with σ̂_MAD computed across all outer test folds',
            ],
            correctIndex: 1,
            explanation:
              'Section 1.4 mandates nested 5×3 stratified CV (avoiding a 4-point deduction for 80/20 holdout) and scales λ_eff = λ₀ / √n_val.',
            pageRef: 'p. 4',
          },
          {
            topic: 'Data Leakage Prevention',
            question:
              'When setting the Huber threshold δ = 1.35 · σ̂_MAD in Lab 3, which residuals must be used to compute σ̂_MAD?',
            options: [
              'Combined outer test and inner training residuals for larger sample size',
              'Strictly the inner training fold residuals to prevent test-fold data leakage',
              'Only the outer test fold residuals after final model selection',
              'Synthetic Gaussian residuals with unit variance',
            ],
            correctIndex: 1,
            explanation:
              'Computing scale statistics on test folds leaks distributional information from held-out data; Lecture 07 requires estimating σ̂_MAD strictly on inner training fold residuals.',
            pageRef: 'p. 4',
          },
          {
            topic: 'Bias-Variance Trade-off',
            question:
              'As regularization strength λ increases from 0 toward ∞ in Ridge regression, how do squared bias and estimator variance behave?',
            options: [
              'Both squared bias and estimator variance decrease monotonically toward zero.',
              'Estimator variance decreases while squared bias increases as weights shrink toward zero.',
              'Irreducible noise σ_ε² shrinks toward zero while variance grows.',
              'Squared bias drops to zero while variance remains constant.',
            ],
            correctIndex: 1,
            explanation:
              'Stronger shrinkage dampens sample-to-sample weight fluctuations (reducing variance) at the cost of pulling f̂(x) toward a constant model (increasing squared bias); σ_ε² remains unchanged.',
            pageRef: 'p. 1–2',
          },
        ],
      },
    },
    comparisons: [
      {
        id: 'seed-comp-1',
        docId: doc1.id,
        docTitle: doc1.title,
        question:
          'What validation protocol, Huber threshold δ, and effective penalty λ_eff are required for CS-402 Lab 3, and what is the penalty for using an 80/20 split?',
        createdAt: 'Nov 12, 2026',
        peakSimilarity: 0.896,
        vectorEngine: 'gemini-embedding-2',
        ragGrounded: true,
        ragAnswer:
          `Per Section 1.4 of your uploaded Lecture 07 notes [p. 4, Chunk #${labChunk.chunkIndex}], CS-402 Lab 3 enforces three specific rules:\n\n` +
          `1. Validation split: Nested 5×3 stratified cross-validation (5 outer test folds, 3 inner tuning folds). Submitting a simple 80/20 holdout split incurs a 4-point rubric deduction.\n` +
          `2. Huber transition threshold: δ = 1.35 · σ̂_MAD, where σ̂_MAD = 1.4826 · median(|r_i − median(r)|) must be computed strictly on inner training fold residuals.\n` +
          `3. Effective penalty formula: λ_eff = λ₀ / √n_val for candidate base values λ₀ ∈ {0.01, 0.1, 1.0, 10.0}.`,
        standardAnswer:
          `I don't have access to your specific university's CS-402 Lab 3 rubric or grading sheet. In general machine learning courses, k-fold cross-validation (commonly 5-fold or 10-fold CV) is preferred over a single 80/20 train-test split when tuning regularization hyperparameters. For Huber loss, the transition parameter δ (often defaulting to 1.35 in scikit-learn's HuberRegressor) controls the switch between quadratic and linear loss, and α or λ is typically tuned via grid search rather than a fixed sample-size formula. Please check your course syllabus for exact grading deductions.`,
        citations: [
          {
            chunkId: labChunk.id,
            docTitle: doc1.title,
            pageNumber: labChunk.pageNumber,
            chunkIndex: labChunk.chunkIndex,
            sectionHeading: labChunk.sectionHeading,
            snippet: labChunk.text,
            similarity: 0.896,
          },
        ],
      },
    ],
  };
}

export function createStarterWorkspaceForNewStudent(userId: string): StudentWorkspaceData {
  const doc = buildSeedDocument({
    id: `doc-lec11-${userId}`,
    userId,
    title: 'Lecture 11: Scaled Attention & Dense RAG Retrieval',
    courseCode: 'CS-402',
    fileName: 'CS402_Lecture11_Attention_and_RAG.pdf',
    uploadedAt: 'Today',
    pages: LECTURE_11_PAGES,
  });

  return {
    documents: [doc],
    messagesByDoc: { [doc.id]: [] },
    summariesByDoc: {},
    quizzesByDoc: {},
    comparisons: [],
  };
}
