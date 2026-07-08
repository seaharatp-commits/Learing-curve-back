import { Injectable, Logger } from "@nestjs/common";
import { AiService } from "./ai.service";
import type {
  DifficultyGuess,
  QuestionAnalysisInput,
  QuestionAnalysisResult,
  QuestionSkillSignal,
} from "./ai-question-understanding.types";

const ANALYSIS_OPTIONS = { temperature: 0.1, maxTokens: 600 };
const MAX_QUESTION_LENGTH = 1200;
const MAX_CONTEXT_LENGTH = 800;
const MAX_KEYWORDS = 12;
const MAX_SKILLS = 6;

const DIFFICULTY_VALUES = new Set<DifficultyGuess>([
  "beginner",
  "intermediate",
  "advanced",
  "unknown",
]);

const ANALYSIS_SYSTEM_PROMPT = [
  "You are analyzing a learner question for a learning platform.",
  "Do not answer the question. Only analyze it.",
  "Return strict JSON only. Do not use Markdown or code fences.",
  "JSON shape:",
  "{",
  '  "originalQuestion": string,',
  '  "interpretedQuestion": string,',
  '  "intent": string,',
  '  "possibleSkills": [{ "skillName": string, "confidence": number }],',
  '  "keywords": string[],',
  '  "difficultyGuess": "beginner" | "intermediate" | "advanced" | "unknown",',
  '  "questionQualityScore": number',
  "}",
  "Rules:",
  "- Keep the original meaning.",
  "- Do not invent details that are not implied.",
  "- possibleSkills must be related to the question.",
  "- confidence must be between 0 and 1.",
  "- questionQualityScore must be between 0 and 1.",
  "- If the question is unclear, set questionQualityScore low.",
  "- If the request includes an \"availableSkills\" list, every possibleSkills.skillName MUST be copied exactly (same spelling and casing) from that list — never invent a new skill name or a more specific variant (e.g. do not say \"React\" if only \"Frontend\" is in the list).",
  "- If the request includes \"availableSkills\" and none of them clearly apply to the question, return an empty possibleSkills array instead of inventing one.",
  "- If no \"availableSkills\" list is given, you may name skills freely.",
].join("\n");

function clamp01(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function limitText(value: string | null | undefined, maxLength: number): string {
  const cleanValue = (value ?? "").trim();
  if (cleanValue.length <= maxLength) return cleanValue;
  return `${cleanValue.slice(0, maxLength).trim()}...`;
}

function uniqueCleanStrings(values: unknown, maxItems: number): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") continue;
    const cleanValue = value.trim();
    if (!cleanValue || seen.has(cleanValue.toLowerCase())) continue;
    seen.add(cleanValue.toLowerCase());
    result.push(cleanValue);
    if (result.length >= maxItems) break;
  }

  return result;
}

@Injectable()
export class AiQuestionUnderstandingService {
  private readonly logger = new Logger(AiQuestionUnderstandingService.name);

  constructor(private readonly aiService: AiService) {}

  async analyzeQuestion(input: QuestionAnalysisInput): Promise<QuestionAnalysisResult> {
    const originalQuestion = input.question.trim();
    if (!originalQuestion) {
      return {
        originalQuestion: "",
        interpretedQuestion: "",
        intent: "empty_question",
        possibleSkills: [],
        keywords: [],
        difficultyGuess: "unknown",
        questionQualityScore: 0.25,
        fallbackUsed: false,
      };
    }

    try {
      const reply = await this.aiService.chat(
        [
          { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(this.buildAnalysisPayload(input)) },
        ],
        ANALYSIS_OPTIONS,
      );

      return this.normalizeAnalysisResult(input, reply);
    } catch (error) {
      this.logger.warn(`AI ล่ม: question analysis unavailable: ${error}`);
      throw new Error(`AI ล่ม: question analysis unavailable (${error})`);
    }
  }

  private buildAnalysisPayload(input: QuestionAnalysisInput) {
    return {
      userId: input.userId,
      contextType: input.contextType,
      question: limitText(input.question, MAX_QUESTION_LENGTH),
      availableSkills: input.availableSkillNames ?? [],
      lesson:
        input.contextType === "LESSON_CHAT" || input.contextType === "LESSON_GENERATION"
          ? {
              id: input.lessonId,
              title: limitText(input.lessonTitle, MAX_CONTEXT_LENGTH),
              summary: limitText(input.lessonSummary, MAX_CONTEXT_LENGTH),
            }
          : undefined,
    };
  }

  private normalizeAnalysisResult(
    input: QuestionAnalysisInput,
    rawReply: string,
  ): QuestionAnalysisResult {
    const parsed = this.parseJsonObject(rawReply);
    const originalQuestion =
      typeof parsed.originalQuestion === "string" && parsed.originalQuestion.trim()
        ? parsed.originalQuestion.trim()
        : input.question.trim();
    const interpretedQuestion =
      typeof parsed.interpretedQuestion === "string" && parsed.interpretedQuestion.trim()
        ? parsed.interpretedQuestion.trim()
        : originalQuestion;
    const intent =
      typeof parsed.intent === "string" && parsed.intent.trim()
        ? parsed.intent.trim()
        : "unknown";

    return {
      originalQuestion,
      interpretedQuestion,
      intent,
      possibleSkills: this.normalizeSkills(parsed.possibleSkills, input.availableSkillNames),
      keywords: uniqueCleanStrings(parsed.keywords, MAX_KEYWORDS),
      difficultyGuess: this.normalizeDifficulty(parsed.difficultyGuess),
      questionQualityScore: clamp01(parsed.questionQualityScore, 0.5),
      fallbackUsed: false,
    };
  }

  private parseJsonObject(rawReply: string): Record<string, unknown> {
    const cleaned = rawReply
      .replace(/```(?:json)?/gi, "")
      .replace(/```/g, "")
      .trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`AI response did not contain JSON: ${cleaned.slice(0, 160)}`);
    }
    return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  }

  private normalizeSkills(value: unknown, availableSkillNames?: string[]): QuestionSkillSignal[] {
    if (!Array.isArray(value)) return [];
    const allowedNames =
      availableSkillNames && availableSkillNames.length > 0
        ? new Set(availableSkillNames.map((name) => name.trim().toLowerCase()))
        : null;
    const seen = new Set<string>();
    const skills: QuestionSkillSignal[] = [];

    for (const item of value) {
      if (typeof item !== "object" || item === null) continue;
      const skillName = (item as { skillName?: unknown }).skillName;
      if (typeof skillName !== "string" || !skillName.trim()) continue;
      const cleanName = skillName.trim();
      const key = cleanName.toLowerCase();
      if (seen.has(key)) continue;
      // Safety net: if we gave the AI a fixed skill list, drop anything it invented anyway
      // instead of letting an unmatched name silently fail to score later.
      if (allowedNames && !allowedNames.has(key)) continue;
      seen.add(key);
      skills.push({
        skillName: cleanName,
        confidence: clamp01((item as { confidence?: unknown }).confidence, 0),
      });
      if (skills.length >= MAX_SKILLS) break;
    }

    return skills.filter((skill) => skill.confidence > 0);
  }

  private normalizeDifficulty(value: unknown): DifficultyGuess {
    return typeof value === "string" && DIFFICULTY_VALUES.has(value as DifficultyGuess)
      ? (value as DifficultyGuess)
      : "unknown";
  }

}
