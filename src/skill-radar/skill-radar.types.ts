import type {
  KnowledgeBaseRecommendation,
  QuestionAnalysisResult,
} from "../ai/ai-question-understanding.types";

export interface SkillRadarPosition {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

export interface SkillRadarSkill {
  id: string;
  positionId: string;
  name: string;
  description: string | null;
  keywords: string[];
  weight: number;
  isActive: boolean;
}

export interface UserSkillRadar {
  position: SkillRadarPosition;
  skills: Array<{
    id: string;
    name: string;
    description: string | null;
    score: number;
    evidenceCount: number;
  }>;
}

export interface SkillAnalysisCandidate {
  skillId: string;
  skillName: string;
  confidence: number;
  reason: string;
}

export interface RecordSkillScoreEventInput {
  userId: string;
  skillId: string;
  sourceType: string;
  sourceId?: string | null;
  scoreDelta: number;
  confidence?: number | null;
  reason?: string | null;
}

export interface RecordQuestionSkillSignalsInput {
  userId: string;
  question: string;
  sourceId?: string | null;
  sourceType?: string;
  maxScoreDelta?: number;
  maxSkillEvents?: number;
  reasonPrefix?: string;
}

export interface RecordQuestionInterestSignalInput {
  userId: string;
  source: "CHAT_QUESTION" | "LESSON_CHAT_QUESTION" | "LESSON_GENERATION_TOPIC";
  sourceId?: string | null;
  question: string;
  analysis: QuestionAnalysisResult;
  recommendations: KnowledgeBaseRecommendation[];
}

export interface PositionSkillSuggestion {
  name: string;
  description: string;
  keywords: string[];
}

export interface RecordLessonCompletionSkillSignalsInput {
  userId: string;
  lessonId: string;
  lessonTitle?: string;
  lessonContent?: string;
  lessonText?: string;
}
