import type {
  KnowledgeBaseRecommendation,
  QuestionAnalysisResult,
} from "../ai/ai-question-understanding.types";
import type { ScoreCalculationResult } from "./skill-score-calculator";

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

export interface PersistSkillScoreResultInput {
  userId: string;
  skillId: string;
  sourceType: string;
  sourceId?: string | null;
  /** Result from calculateSkillScore/calculatePositiveSkillScore/calculateWrongAnswerSkillScore. */
  result: ScoreCalculationResult;
  /**
   * Overrides result.scoreDelta when a caller must adjust it after the fact
   * (e.g. anti-farming caps). evidenceCount/confidence/wrongStreak/masteryPoint
   * are still taken from `result` — the event genuinely happened, only the
   * score impact of it is being capped.
   */
  scoreDeltaOverride?: number;
  /** Per-event signal confidence (e.g. AI classifier confidence for this one
   * event) — distinct from the running skill-mastery confidence in `result`. */
  eventConfidence?: number | null;
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

export interface CareerAlignment {
  position: string;
  level: string;
  alignmentScore: number;
  strengths: string[];
  description: string;
  quotes: string[];
  nextSteps: string[];
  /** "ai" when the description came from the AI Center, "fallback" otherwise. */
  generatedBy: "ai" | "fallback";
}
