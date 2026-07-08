export type QuestionContextType = "GENERAL_CHAT" | "LESSON_CHAT" | "LESSON_GENERATION";

export type DifficultyGuess = "beginner" | "intermediate" | "advanced" | "unknown";

export interface QuestionSkillSignal {
  skillName: string;
  confidence: number;
}

export interface QuestionAnalysisInput {
  userId: string;
  question: string;
  contextType: QuestionContextType;
  lessonId?: string;
  lessonTitle?: string;
  lessonSummary?: string | null;
  /** Real skill names from the learner's current position — the AI must only choose from this list. */
  availableSkillNames?: string[];
}

export interface QuestionAnalysisResult {
  originalQuestion: string;
  interpretedQuestion: string;
  intent: string;
  possibleSkills: QuestionSkillSignal[];
  keywords: string[];
  difficultyGuess: DifficultyGuess;
  questionQualityScore: number;
  fallbackUsed?: boolean;
}

export interface KnowledgeBaseCandidate {
  id: string;
  title: string;
  summary?: string | null;
  tags: string[];
  relatedSkills: string[];
  difficulty?: string | null;
  contentPreview?: string | null;
  databaseRelevanceScore?: number;
}

export interface KnowledgeBaseRecommendation {
  knowledgeBaseId: string;
  confidenceScore: number;
  matchedSkills: string[];
  reason: string;
  whyThisKBIsRelevant: string;
  shouldRecommend: boolean;
}
