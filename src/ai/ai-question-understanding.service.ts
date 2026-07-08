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

const GENERIC_TOKENS = new Set([
  "the",
  "and",
  "for",
  "with",
  "what",
  "why",
  "how",
  "please",
  "help",
  "about",
  "want",
  "know",
  "อยากรู้",
  "ช่วย",
  "บอก",
  "เกี่ยวกับ",
  "ขอ",
  "หน่อย",
  "อธิบาย",
  "คืออะไร",
  "ทำยังไง",
  "วิธี",
  "ขั้นตอน",
  "ปัญหา",
  "ระบบ",
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
      return this.buildFallbackResult(input, "");
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
      this.logger.warn(`AI question analysis failed, using fallback: ${error}`);
      return this.buildFallbackResult(input, originalQuestion);
    }
  }

  private buildAnalysisPayload(input: QuestionAnalysisInput) {
    return {
      userId: input.userId,
      contextType: input.contextType,
      question: limitText(input.question, MAX_QUESTION_LENGTH),
      lesson:
        input.contextType === "LESSON_CHAT" || input.contextType === "LESSON_GENERATION"
          ? {
              id: input.lessonId,
              title: limitText(input.lessonTitle, MAX_CONTEXT_LENGTH),
              summary: limitText(input.lessonSummary, MAX_CONTEXT_LENGTH),
              skills: input.lessonSkills ?? [],
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
      possibleSkills: this.normalizeSkills(parsed.possibleSkills),
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

  private normalizeSkills(value: unknown): QuestionSkillSignal[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const skills: QuestionSkillSignal[] = [];

    for (const item of value) {
      if (typeof item !== "object" || item === null) continue;
      const skillName = (item as { skillName?: unknown }).skillName;
      if (typeof skillName !== "string" || !skillName.trim()) continue;
      const cleanName = skillName.trim();
      const key = cleanName.toLowerCase();
      if (seen.has(key)) continue;
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

  private buildFallbackResult(
    input: QuestionAnalysisInput,
    originalQuestion: string,
  ): QuestionAnalysisResult {
    const question = originalQuestion || input.question.trim();
    return {
      originalQuestion: question,
      interpretedQuestion: question,
      intent: question ? "unknown" : "empty_question",
      possibleSkills: [],
      keywords: this.extractFallbackKeywords(question),
      difficultyGuess: "unknown",
      questionQualityScore: question.length >= 8 ? 0.5 : 0.25,
      fallbackUsed: true,
    };
  }

  private extractFallbackKeywords(question: string): string[] {
    const tokens = question.toLowerCase().match(/[a-z0-9ก-๙+#._-]+/g) ?? [];
    const keywords: string[] = [];
    const seen = new Set<string>();

    for (const token of tokens) {
      const cleanToken = token.trim();
      if (cleanToken.length < 2 || GENERIC_TOKENS.has(cleanToken)) continue;
      if (seen.has(cleanToken)) continue;
      seen.add(cleanToken);
      keywords.push(cleanToken);
      if (keywords.length >= MAX_KEYWORDS) break;
    }

    return keywords;
  }
}
