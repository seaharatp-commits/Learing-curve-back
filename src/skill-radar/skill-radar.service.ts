import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";
import { buildFingerprint, jaccardScore } from "../knowledge-base/text-similarity.util";
import type {
  PositionSkillSuggestion,
  RecordLessonCompletionSkillSignalsInput,
  RecordQuestionInterestSignalInput,
  RecordQuestionSkillSignalsInput,
  RecordSkillScoreEventInput,
  SkillAnalysisCandidate,
  SkillRadarPosition,
  SkillRadarSkill,
  UserSkillRadar,
} from "./skill-radar.types";
import type { PositionDto } from "./dto/position.dto";
import type { PositionSkillDto } from "./dto/position-skill.dto";
import type { SetQuestionSkillsDto } from "./dto/set-question-skills.dto";
import type { UpdateMyPositionDto } from "./dto/update-my-position.dto";

const DEFAULT_POSITION_NAME = "Software Engineer";
const SKILL_SCORE_SOURCE_AI_CHAT_QUESTION = "AI_CHAT_QUESTION";
const SKILL_SCORE_SOURCE_CHAT_QUESTION_INTEREST = "CHAT_QUESTION_INTEREST";
const SKILL_SCORE_SOURCE_LESSON_CHAT_QUESTION_INTEREST = "LESSON_CHAT_QUESTION_INTEREST";
const SKILL_SCORE_SOURCE_LESSON_GENERATION_TOPIC_INTEREST = "LESSON_GENERATION_TOPIC_INTEREST";
const AI_CHAT_MIN_CONFIDENCE = 0.2;
const AI_CHAT_MAX_SKILL_EVENTS = 3;
const AI_CHAT_MAX_SCORE_DELTA = 3;
const AI_CLASSIFIER_MIN_CONFIDENCE = 0.4;
const AI_CLASSIFIER_OPTIONS = { temperature: 0.1, maxTokens: 400 };
const AI_CLASSIFIER_MAX_QUESTION_LENGTH = 900;
const ANTI_FARMING_WINDOW_HOURS = 24;
const AI_CHAT_DAILY_SKILL_EVENT_CAP = 8;
const AI_CHAT_DAILY_SKILL_SCORE_CAP = 15;
const AI_CHAT_DAILY_USER_EVENT_CAP = 25;
const AI_CHAT_DAILY_USER_SCORE_CAP = 35;
const AI_CHAT_SESSION_SKILL_EVENT_CAP = 5;
const SIMILAR_QUESTION_JACCARD_THRESHOLD = 0.5;
const DUPLICATE_QUESTION_JACCARD_THRESHOLD = 0.85;
const SIMILAR_QUESTION_DECAY = 0.2;
const POSITION_SKILL_SUGGESTION_MIN = 3;
const POSITION_SKILL_SUGGESTION_MAX = 7;
const SKILL_SCORE_SOURCE_LESSON_COMPLETION = "LESSON_COMPLETION";
const LESSON_COMPLETION_MIN_CONFIDENCE = 0.2;
const LESSON_COMPLETION_MAX_SKILL_EVENTS = 2;
const LESSON_COMPLETION_MAX_SCORE_DELTA = 1.2;
const LESSON_COMPLETION_MAX_CONTENT_LENGTH = 4000;
const BASE_INTEREST_POINT = 0.5;
const MIN_INTEREST_QUESTION_QUALITY = 0.45;
const MIN_INTEREST_SKILL_CONFIDENCE = 0.45;
const MAX_INTEREST_GAIN_PER_QUESTION = 1;

interface AdminSkillScoreEventQuery {
  limit?: number;
  page?: number;
  userId?: string;
  positionId?: string;
  skillId?: string;
  sourceType?: string;
  search?: string;
}

@Injectable()
export class SkillRadarService {
  private readonly logger = new Logger(SkillRadarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  async listPositions(): Promise<SkillRadarPosition[]> {
    return this.prisma.position.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true, isActive: true },
    });
  }

  async listAdminPositions() {
    return this.prisma.position.findMany({
      orderBy: { name: "asc" },
      include: { skills: { orderBy: { createdAt: "asc" } } },
    });
  }

  async listAdminSkillScoreEvents(query: AdminSkillScoreEventQuery = {}) {
    const take = Math.max(1, Math.min(Number(query.limit) || 30, 100));
    const page = Math.max(1, Number(query.page) || 1);
    const skip = (page - 1) * take;
    const search = query.search?.trim();
    const where: Prisma.SkillScoreEventWhereInput = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.positionId ? { positionId: query.positionId } : {}),
      ...(query.skillId ? { skillId: query.skillId } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
      ...(search
        ? {
            OR: [
              { reason: { contains: search, mode: "insensitive" } },
              { sourceType: { contains: search, mode: "insensitive" } },
              { user: { name: { contains: search, mode: "insensitive" } } },
              { user: { email: { contains: search, mode: "insensitive" } } },
              { position: { name: { contains: search, mode: "insensitive" } } },
              { skill: { name: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.skillScoreEvent.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, name: true, email: true } },
          position: { select: { id: true, name: true } },
          skill: { select: { id: true, name: true } },
        },
      }),
      this.prisma.skillScoreEvent.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit: take,
      totalPages: Math.max(1, Math.ceil(total / take)),
    };
  }

  async createPosition(dto: PositionDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException("กรุณาระบุชื่อตำแหน่ง");

    return this.prisma.position.create({
      data: {
        name,
        description: dto.description?.trim() || null,
        isActive: dto.isActive ?? true,
      },
      include: { skills: { orderBy: { createdAt: "asc" } } },
    });
  }

  async updatePosition(positionId: string, dto: PositionDto) {
    const position = await this.prisma.position.findUnique({ where: { id: positionId } });
    if (!position) throw new NotFoundException("ไม่พบตำแหน่งนี้");

    const name = dto.name.trim();
    if (!name) throw new BadRequestException("กรุณาระบุชื่อตำแหน่ง");

    return this.prisma.position.update({
      where: { id: positionId },
      data: {
        name,
        description: dto.description?.trim() || null,
        isActive: dto.isActive ?? position.isActive,
      },
      include: { skills: { orderBy: { createdAt: "asc" } } },
    });
  }

  async listSkills(positionId: string): Promise<SkillRadarSkill[]> {
    const position = await this.prisma.position.findUnique({ where: { id: positionId } });
    if (!position || !position.isActive) throw new NotFoundException("ไม่พบตำแหน่งนี้");

    return this.prisma.positionSkill.findMany({
      where: { positionId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        positionId: true,
        name: true,
        description: true,
        keywords: true,
        weight: true,
        isActive: true,
      },
    });
  }

  async createSkill(positionId: string, dto: PositionSkillDto) {
    const position = await this.prisma.position.findUnique({ where: { id: positionId } });
    if (!position) throw new NotFoundException("ไม่พบตำแหน่งนี้");

    const name = dto.name.trim();
    if (!name) throw new BadRequestException("กรุณาระบุชื่อ skill");

    return this.prisma.positionSkill.create({
      data: {
        positionId,
        name,
        description: dto.description?.trim() || null,
        keywords: dto.keywords ?? [],
        weight: dto.weight ?? 1,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateSkill(skillId: string, dto: PositionSkillDto) {
    const skill = await this.prisma.positionSkill.findUnique({ where: { id: skillId } });
    if (!skill) throw new NotFoundException("ไม่พบ skill นี้");

    const name = dto.name.trim();
    if (!name) throw new BadRequestException("กรุณาระบุชื่อ skill");

    return this.prisma.positionSkill.update({
      where: { id: skillId },
      data: {
        name,
        description: dto.description?.trim() || null,
        keywords: dto.keywords ?? skill.keywords,
        weight: dto.weight ?? skill.weight,
        isActive: dto.isActive ?? skill.isActive,
      },
    });
  }

  private buildPositionSkillSuggestionPrompt(positionName: string, positionDescription: string | null): string {
    return [
      "You are helping design a skill assessment radar for a learning platform.",
      `Position: "${positionName}"${positionDescription ? `\nPosition description: ${positionDescription}` : ""}`,
      `Suggest between ${POSITION_SKILL_SUGGESTION_MIN} and ${POSITION_SKILL_SUGGESTION_MAX} core skills that best represent competency areas for this position.`,
      "Respond with ONLY a JSON array (no markdown, no commentary) where each item is shaped exactly as:",
      '[{"name": "<short skill name, max 120 chars>", "description": "<1-2 sentence description, max 500 chars>", "keywords": ["<keyword>", "..."]}]',
      "Each skill must have 3 to 8 keywords useful for detecting the skill from quiz questions or chat messages.",
      "Keep skill names concise and non-overlapping with each other.",
    ].join("\n");
  }

  async suggestSkillsForPosition(positionId: string): Promise<PositionSkillSuggestion[]> {
    const position = await this.prisma.position.findUnique({ where: { id: positionId } });
    if (!position) throw new NotFoundException("ไม่พบตำแหน่งนี้");

    const prompt = this.buildPositionSkillSuggestionPrompt(position.name, position.description);
    const reply = await this.aiService.chat(
      [
        {
          role: "system",
          content: "You output only valid JSON. You never include commentary, markdown fences, or text outside the JSON array.",
        },
        { role: "user", content: prompt },
      ],
      AI_CLASSIFIER_OPTIONS,
    );

    const rawSuggestions = this.extractJsonArray(reply);

    const suggestions: PositionSkillSuggestion[] = rawSuggestions
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({
        name: typeof item.name === "string" ? item.name.trim().slice(0, 120) : "",
        description: typeof item.description === "string" ? item.description.trim().slice(0, 500) : "",
        keywords: Array.isArray(item.keywords)
          ? item.keywords
              .filter((keyword): keyword is string => typeof keyword === "string" && keyword.trim().length > 0)
              .map((keyword) => keyword.trim().slice(0, 80))
              .slice(0, 30)
          : [],
      }))
      .filter((suggestion) => suggestion.name.length > 0)
      .slice(0, POSITION_SKILL_SUGGESTION_MAX);

    if (suggestions.length < POSITION_SKILL_SUGGESTION_MIN) {
      throw new BadRequestException("AI ไม่สามารถแนะนำ skill ได้เพียงพอ กรุณาลองใหม่อีกครั้ง");
    }

    return suggestions;
  }

  async getUserRadar(userId: string, positionId?: string): Promise<UserSkillRadar> {
    const position = await this.resolveUserPosition(userId, positionId);
    const skills = await this.prisma.positionSkill.findMany({
      where: { positionId: position.id, isActive: true },
      orderBy: { createdAt: "asc" },
      include: {
        userSkillScores: {
          where: { userId },
          take: 1,
        },
      },
    });

    return {
      position: {
        id: position.id,
        name: position.name,
        description: position.description,
        isActive: position.isActive,
      },
      skills: skills.map((skill) => {
        const score = skill.userSkillScores[0];
        return {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          score: score ? Math.round(score.score) : 0,
          evidenceCount: score?.evidenceCount ?? 0,
        };
      }),
    };
  }

  async updateMyPosition(userId: string, dto: UpdateMyPositionDto): Promise<UserSkillRadar> {
    const position = await this.resolvePosition(dto.positionId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { preferredPositionId: position.id },
    });
    return this.getUserRadar(userId, position.id);
  }

  private normalizeForMatch(value: string): string {
    return value.toLowerCase().replace(/[\s_\-/.]+/g, "");
  }

  private getMatchTokens(value: string): Set<string> {
    return buildFingerprint([value]);
  }

  private buildSkillClassifierPrompt(question: string, skills: SkillRadarSkill[]): string {
    const cleanQuestion =
      question.length > AI_CLASSIFIER_MAX_QUESTION_LENGTH
        ? `${question.slice(0, AI_CLASSIFIER_MAX_QUESTION_LENGTH).trim()}...`
        : question;
    const skillList = skills
      .map((skill) => `- id: ${skill.id} | name: ${skill.name}${skill.description ? ` | description: ${skill.description}` : ""}`)
      .join("\n");

    return [
      "You are a strict skill-classification engine for a learning platform.",
      "Given a learner's chat question, decide which of the following skills (if any) the question demonstrates knowledge of or interest in.",
      "You MUST only choose skillId values from this exact list — never invent a skillId:",
      skillList,
      "",
      `Learner question: "${cleanQuestion}"`,
      "",
      "Respond with ONLY a JSON array (no markdown, no explanation outside the JSON) of at most 3 items, each shaped exactly as:",
      '[{"skillId": "<id from the list above>", "confidence": <number between 0 and 1>, "reason": "<short reason in Thai or English>"}]',
      "If no skill from the list clearly applies, respond with an empty array: []",
    ].join("\n");
  }

  private extractJsonArray(raw: string): unknown[] {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("AI response did not contain a JSON array");

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) throw new Error("AI response JSON is not an array");

    return parsed;
  }

  private parseSkillClassifierResponse(raw: string): Array<{ skillId: string; confidence: number; reason: string }> {
    return this.extractJsonArray(raw) as Array<{ skillId: string; confidence: number; reason: string }>;
  }

  private async analyzeQuestionSkillsWithAi(
    question: string,
    skills: SkillRadarSkill[],
  ): Promise<SkillAnalysisCandidate[]> {
    if (skills.length === 0) return [];

    const skillById = new Map(skills.map((skill) => [skill.id, skill]));
    const prompt = this.buildSkillClassifierPrompt(question, skills);
    const reply = await this.aiService.chat(
      [
        {
          role: "system",
          content: "You output only valid JSON. You never include commentary, markdown fences, or text outside the JSON array.",
        },
        { role: "user", content: prompt },
      ],
      AI_CLASSIFIER_OPTIONS,
    );

    const rawCandidates = this.parseSkillClassifierResponse(reply);

    return rawCandidates
      .filter((candidate) => candidate && typeof candidate.skillId === "string" && skillById.has(candidate.skillId))
      .map((candidate) => {
        const skill = skillById.get(candidate.skillId)!;
        const confidence = Math.max(0, Math.min(1, Number(candidate.confidence) || 0));
        return {
          skillId: skill.id,
          skillName: skill.name,
          confidence,
          reason: typeof candidate.reason === "string" && candidate.reason.trim() ? candidate.reason.trim() : "AI classifier match",
        };
      })
      .filter((candidate) => Number.isFinite(candidate.confidence) && candidate.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);
  }

  async recordQuestionSkillSignals(input: RecordQuestionSkillSignalsInput) {
    const question = input.question.trim();
    if (question.length < 3) return [];
    if (this.getMatchTokens(question).size < 2) return [];
    const sourceType = input.sourceType ?? SKILL_SCORE_SOURCE_AI_CHAT_QUESTION;
    const maxSkillEvents = Math.max(1, Math.min(input.maxSkillEvents ?? AI_CHAT_MAX_SKILL_EVENTS, 5));
    const maxScoreDelta = Math.max(0.1, Math.min(input.maxScoreDelta ?? AI_CHAT_MAX_SCORE_DELTA, AI_CHAT_MAX_SCORE_DELTA));
    const reasonPrefix = input.reasonPrefix ?? "AI chat question signal";

    if (input.sourceId) {
      const existingSourceEvents = await this.prisma.skillScoreEvent.findMany({
        where: {
          userId: input.userId,
          sourceType,
          sourceId: input.sourceId,
        },
        take: 1,
        select: { id: true },
      });
      if (existingSourceEvents.length > 0) return [];
    }

    const position = await this.resolveUserPosition(input.userId);
    const skills = await this.prisma.positionSkill.findMany({
      where: { positionId: position.id, isActive: true, position: { isActive: true } },
      select: {
        id: true,
        positionId: true,
        name: true,
        description: true,
        keywords: true,
        weight: true,
        isActive: true,
      },
    });

    const skillById = new Map(skills.map((skill) => [skill.id, skill]));

    let candidates: SkillAnalysisCandidate[];
    try {
      candidates = (await this.analyzeQuestionSkillsWithAi(question, skills)).filter(
        (candidate) => candidate.confidence >= AI_CLASSIFIER_MIN_CONFIDENCE,
      );
    } catch (error) {
      this.logger.warn(`AI ล่ม: skill classifier unavailable, skipping skill signal: ${error}`);
      return [];
    }
    candidates = candidates.slice(0, maxSkillEvents);

    const events = [];
    for (const candidate of candidates) {
      const skill = skillById.get(candidate.skillId);
      const skillWeight = Math.min(skill?.weight ?? 1, 1.5);
      let scoreDelta =
        Math.round(
          Math.min(maxScoreDelta, candidate.confidence * maxScoreDelta * skillWeight) * 100,
        ) / 100;

      if (scoreDelta <= 0) continue;

      const antiFarming = await this.applyChatAntiFarmingAdjustment(
        input.userId,
        candidate.skillId,
        question,
        scoreDelta,
        input.sourceId ?? null,
        sourceType,
      );
      scoreDelta = antiFarming.scoreDelta;
      if (scoreDelta <= 0) continue;

      events.push(
        await this.recordSkillScoreEvent({
          userId: input.userId,
          skillId: candidate.skillId,
          sourceType,
          sourceId: input.sourceId ?? null,
          scoreDelta,
          confidence: candidate.confidence,
          reason: `${reasonPrefix} (ai-classifier): ${candidate.reason}${antiFarming.note ? ` | anti-farming: ${antiFarming.note}` : ""}`,
        }),
      );
    }

    return events;
  }

  async recordQuestionInterestSignal(input: RecordQuestionInterestSignalInput) {
    const question = input.question.trim();
    if (question.length < 3) return [];
    if (input.analysis.questionQualityScore < MIN_INTEREST_QUESTION_QUALITY) return [];

    const sourceType = this.getQuestionInterestSourceType(input.source);
    if (input.sourceId) {
      const existingSourceEvents = await this.prisma.skillScoreEvent.findMany({
        where: {
          userId: input.userId,
          sourceType,
          sourceId: input.sourceId,
        },
        take: 1,
        select: { id: true },
      });
      if (existingSourceEvents.length > 0) return [];
    }

    const position = await this.resolveUserPosition(input.userId);
    const skills = await this.prisma.positionSkill.findMany({
      where: { positionId: position.id, isActive: true, position: { isActive: true } },
      select: {
        id: true,
        positionId: true,
        name: true,
        description: true,
        keywords: true,
        weight: true,
        isActive: true,
      },
    });
    const skillByName = new Map(skills.map((skill) => [this.normalizeForMatch(skill.name), skill]));
    const recommendationMultiplier = this.getRecommendationConfidenceMultiplier(input.recommendations);
    const events = [];

    for (const analyzedSkill of input.analysis.possibleSkills.slice(0, 3)) {
      if (analyzedSkill.confidence < MIN_INTEREST_SKILL_CONFIDENCE) continue;

      const skill = skillByName.get(this.normalizeForMatch(analyzedSkill.skillName));
      if (!skill) continue;

      const skillWeight = Math.min(skill.weight ?? 1, 1.5);
      let scoreDelta =
        Math.round(
          Math.min(
            MAX_INTEREST_GAIN_PER_QUESTION,
            BASE_INTEREST_POINT *
              input.analysis.questionQualityScore *
              analyzedSkill.confidence *
              recommendationMultiplier *
              skillWeight,
          ) * 100,
        ) / 100;
      if (scoreDelta <= 0) continue;

      const antiFarming = await this.applyChatAntiFarmingAdjustment(
        input.userId,
        skill.id,
        question,
        scoreDelta,
        input.sourceId ?? null,
        sourceType,
      );
      scoreDelta = antiFarming.scoreDelta;
      if (scoreDelta <= 0) continue;

      const recommendationIds = input.recommendations
        .filter((recommendation) => recommendation.shouldRecommend)
        .map((recommendation) => `${recommendation.knowledgeBaseId}:${recommendation.confidenceScore}`)
        .slice(0, 3)
        .join(", ");

      events.push(
        await this.recordSkillScoreEvent({
          userId: input.userId,
          skillId: skill.id,
          sourceType,
          sourceId: input.sourceId ?? null,
          scoreDelta,
          confidence: Math.round(analyzedSkill.confidence * 100) / 100,
          reason:
            `Interest signal only: ${analyzedSkill.skillName} from learner question. ` +
            `quality=${Math.round(input.analysis.questionQualityScore * 100) / 100}, ` +
            `interpreted="${input.analysis.interpretedQuestion.slice(0, 160)}"` +
            (recommendationIds ? `, kb=${recommendationIds}` : "") +
            (antiFarming.note ? ` | anti-farming: ${antiFarming.note}` : ""),
        }),
      );
    }

    return events;
  }

  private getQuestionInterestSourceType(source: RecordQuestionInterestSignalInput["source"]) {
    if (source === "LESSON_CHAT_QUESTION") return SKILL_SCORE_SOURCE_LESSON_CHAT_QUESTION_INTEREST;
    if (source === "LESSON_GENERATION_TOPIC") return SKILL_SCORE_SOURCE_LESSON_GENERATION_TOPIC_INTEREST;
    return SKILL_SCORE_SOURCE_CHAT_QUESTION_INTEREST;
  }

  private getRecommendationConfidenceMultiplier(recommendations: Array<{ confidenceScore: number }>) {
    if (recommendations.length === 0) return 0.75;
    const bestConfidence = Math.max(0, ...recommendations.map((recommendation) => recommendation.confidenceScore));
    return Math.max(0.5, Math.min(1.2, 0.75 + bestConfidence * 0.45));
  }

  async analyzeUserTextSkills(userId: string, text: string, minConfidence = AI_CHAT_MIN_CONFIDENCE) {
    const cleanText = text.trim();
    if (cleanText.length < 3) return { candidates: [] as SkillAnalysisCandidate[], usedAiClassifier: false };
    if (this.getMatchTokens(cleanText).size < 2) {
      return { candidates: [] as SkillAnalysisCandidate[], usedAiClassifier: false };
    }

    const position = await this.resolveUserPosition(userId);
    const skills = await this.prisma.positionSkill.findMany({
      where: { positionId: position.id, isActive: true, position: { isActive: true } },
      select: {
        id: true,
        positionId: true,
        name: true,
        description: true,
        keywords: true,
        weight: true,
        isActive: true,
      },
    });

    try {
      const candidates = (await this.analyzeQuestionSkillsWithAi(cleanText, skills)).filter(
        (candidate) => candidate.confidence >= minConfidence,
      );
      return { candidates, usedAiClassifier: true };
    } catch (error) {
      this.logger.warn(`AI ล่ม: skill classifier unavailable, skipping skill inference: ${error}`);
      return { candidates: [] as SkillAnalysisCandidate[], usedAiClassifier: false };
    }
  }

  async recordLessonCompletionSkillSignals(input: RecordLessonCompletionSkillSignalsInput) {
    const title = (input.lessonTitle ?? "").trim();
    const content = (input.lessonContent ?? input.lessonText ?? "").trim();
    const limitedContent =
      content.length > LESSON_COMPLETION_MAX_CONTENT_LENGTH
        ? `${content.slice(0, LESSON_COMPLETION_MAX_CONTENT_LENGTH).trim()}...`
        : content;
    const text = [title, limitedContent].filter(Boolean).join("\n").trim();
    if (text.length < 3) return [];
    if (this.getMatchTokens(text).size < 2) return [];

    const existingLessonEvents = await this.prisma.skillScoreEvent.findMany({
      where: {
        userId: input.userId,
        sourceType: SKILL_SCORE_SOURCE_LESSON_COMPLETION,
        sourceId: input.lessonId,
      },
      take: 1,
      select: { id: true },
    });
    if (existingLessonEvents.length > 0) return [];

    const position = await this.resolveUserPosition(input.userId);
    const skills = await this.prisma.positionSkill.findMany({
      where: { positionId: position.id, isActive: true, position: { isActive: true } },
      select: {
        id: true,
        positionId: true,
        name: true,
        description: true,
        keywords: true,
        weight: true,
        isActive: true,
      },
    });

    const skillById = new Map(skills.map((skill) => [skill.id, skill]));

    let candidates: SkillAnalysisCandidate[];
    try {
      candidates = (await this.analyzeQuestionSkillsWithAi(text, skills)).filter(
        (candidate) => candidate.confidence >= LESSON_COMPLETION_MIN_CONFIDENCE,
      );
    } catch (error) {
      this.logger.warn(`AI ล่ม: skill classifier unavailable, skipping lesson completion skill signal: ${error}`);
      return [];
    }
    candidates = candidates.slice(0, LESSON_COMPLETION_MAX_SKILL_EVENTS);

    const events = [];
    for (const candidate of candidates) {
      const skill = skillById.get(candidate.skillId);
      const skillWeight = Math.min(skill?.weight ?? 1, 1.5);
      const scoreDelta =
        Math.round(
          Math.min(
            LESSON_COMPLETION_MAX_SCORE_DELTA,
            candidate.confidence * LESSON_COMPLETION_MAX_SCORE_DELTA * skillWeight,
          ) * 100,
        ) / 100;

      if (scoreDelta <= 0) continue;

      events.push(
        await this.recordSkillScoreEvent({
          userId: input.userId,
          skillId: candidate.skillId,
          sourceType: SKILL_SCORE_SOURCE_LESSON_COMPLETION,
          sourceId: input.lessonId,
          scoreDelta,
          confidence: candidate.confidence,
          reason: `Lesson completion signal (ai-classifier): ${candidate.reason}`,
        }),
      );
    }

    return events;
  }

  private async applyChatAntiFarmingAdjustment(
    userId: string,
    skillId: string,
    question: string,
    scoreDelta: number,
    sourceId: string | null,
    sourceType = SKILL_SCORE_SOURCE_AI_CHAT_QUESTION,
  ): Promise<{ scoreDelta: number; note: string | null }> {
    const since = new Date(Date.now() - ANTI_FARMING_WINDOW_HOURS * 60 * 60 * 1000);
    const recentUserEvents = await this.prisma.skillScoreEvent.findMany({
      where: {
        userId,
        sourceType,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { sourceId: true, scoreDelta: true, skillId: true },
    });

    const totalScoreSoFar = recentUserEvents.reduce((sum, event) => sum + event.scoreDelta, 0);
    if (
      recentUserEvents.length >= AI_CHAT_DAILY_USER_EVENT_CAP ||
      totalScoreSoFar >= AI_CHAT_DAILY_USER_SCORE_CAP
    ) {
      return {
        scoreDelta: 0,
        note: `daily user cap reached (${recentUserEvents.length} events / ${totalScoreSoFar} pts in ${ANTI_FARMING_WINDOW_HOURS}h)`,
      };
    }

    const recentEvents = recentUserEvents.filter((event) => event.skillId === skillId);

    if (sourceId) {
      const currentMessage = await this.prisma.chatMessage.findUnique({
        where: { id: sourceId },
        select: { sessionId: true },
      });
      if (currentMessage?.sessionId) {
        const sessionMessages = await this.prisma.chatMessage.findMany({
          where: {
            sessionId: currentMessage.sessionId,
            createdAt: { gte: since },
          },
          select: { id: true },
        });
        const sessionMessageIds = new Set(sessionMessages.map((message) => message.id));
        const sessionSkillEventCount = recentEvents.filter(
          (event) => event.sourceId && sessionMessageIds.has(event.sourceId),
        ).length;
        if (sessionSkillEventCount >= AI_CHAT_SESSION_SKILL_EVENT_CAP) {
          return {
            scoreDelta: 0,
            note: `session skill cap reached (${sessionSkillEventCount} events for this skill in the current session)`,
          };
        }
      }
    }

    if (recentEvents.length === 0) return { scoreDelta, note: null };

    const scoreSoFar = recentEvents.reduce((sum, event) => sum + event.scoreDelta, 0);
    if (recentEvents.length >= AI_CHAT_DAILY_SKILL_EVENT_CAP || scoreSoFar >= AI_CHAT_DAILY_SKILL_SCORE_CAP) {
      return { scoreDelta: 0, note: `daily skill cap reached (${recentEvents.length} events / ${scoreSoFar} pts in ${ANTI_FARMING_WINDOW_HOURS}h)` };
    }

    const recentSourceIds = recentEvents.map((event) => event.sourceId).filter((id): id is string => !!id);
    if (recentSourceIds.length > 0) {
      const recentMessages = await this.prisma.chatMessage.findMany({
        where: { id: { in: recentSourceIds } },
        select: { content: true },
      });
      const newFingerprint = buildFingerprint([question]);
      const similarity = Math.max(
        0,
        ...recentMessages.map((message) =>
          jaccardScore(newFingerprint, buildFingerprint([message.content])),
        ),
      );
      if (similarity >= DUPLICATE_QUESTION_JACCARD_THRESHOLD) {
        return {
          scoreDelta: 0,
          note: `duplicate or near-duplicate question detected (${Math.round(similarity * 100)}% similar)`,
        };
      }
      if (similarity >= SIMILAR_QUESTION_JACCARD_THRESHOLD) {
        const decayed = Math.round(scoreDelta * SIMILAR_QUESTION_DECAY * 100) / 100;
        return {
          scoreDelta: decayed,
          note: `similar to a recently asked question, score reduced (${Math.round(similarity * 100)}% similar)`,
        };
      }
    }

    const remainingBudget = AI_CHAT_DAILY_SKILL_SCORE_CAP - scoreSoFar;
    if (scoreDelta > remainingBudget) {
      return { scoreDelta: Math.max(0, Math.round(remainingBudget * 100) / 100), note: "capped to remaining daily skill budget" };
    }

    const remainingUserBudget = AI_CHAT_DAILY_USER_SCORE_CAP - totalScoreSoFar;
    if (scoreDelta > remainingUserBudget) {
      return { scoreDelta: Math.max(0, Math.round(remainingUserBudget * 100) / 100), note: "capped to remaining daily user budget" };
    }

    return { scoreDelta, note: null };
  }

  async recordSkillScoreEvent(input: RecordSkillScoreEventInput) {
    if (!Number.isFinite(input.scoreDelta) || input.scoreDelta === 0) {
      throw new BadRequestException("scoreDelta ต้องเป็นตัวเลขที่ไม่ใช่ 0");
    }

    const skill = await this.prisma.positionSkill.findUnique({
      where: { id: input.skillId },
      include: { position: true },
    });
    if (!skill || !skill.isActive || !skill.position.isActive) {
      throw new NotFoundException("ไม่พบ skill นี้");
    }

    const existing = await this.prisma.userSkillScore.findUnique({
      where: { userId_skillId: { userId: input.userId, skillId: input.skillId } },
    });
    const scoreBefore = existing?.score ?? 0;
    const scoreAfter = Math.max(0, Math.min(100, scoreBefore + input.scoreDelta));

    const [score, event] = await this.prisma.$transaction([
      this.prisma.userSkillScore.upsert({
        where: { userId_skillId: { userId: input.userId, skillId: input.skillId } },
        update: {
          score: scoreAfter,
          evidenceCount: { increment: 1 },
        },
        create: {
          userId: input.userId,
          positionId: skill.positionId,
          skillId: input.skillId,
          score: scoreAfter,
          evidenceCount: 1,
        },
      }),
      this.prisma.skillScoreEvent.create({
        data: {
          userId: input.userId,
          positionId: skill.positionId,
          skillId: input.skillId,
          sourceType: input.sourceType,
          sourceId: input.sourceId ?? null,
          scoreDelta: input.scoreDelta,
          scoreBefore,
          scoreAfter,
          confidence: input.confidence ?? null,
          reason: input.reason ?? null,
        },
      }),
    ]);

    return { score, event };
  }

  async setQuestionSkillMappings(questionId: string, dto: SetQuestionSkillsDto) {
    const question = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!question) throw new NotFoundException("ไม่พบคำถามนี้");

    const uniqueMappings = Array.from(
      new Map(dto.mappings.map((mapping) => [mapping.skillId, mapping])).values(),
    );
    const skillIds = uniqueMappings.map((mapping) => mapping.skillId);
    const skills =
      skillIds.length === 0
        ? []
        : await this.prisma.positionSkill.findMany({
            where: { id: { in: skillIds }, isActive: true, position: { isActive: true } },
            select: { id: true },
          });

    if (skills.length !== skillIds.length) {
      throw new BadRequestException("มี skill บางรายการที่ไม่พร้อมใช้งานหรือไม่มีอยู่จริง");
    }

    await this.prisma.$transaction([
      this.prisma.quizQuestionSkill.deleteMany({ where: { questionId } }),
      ...(uniqueMappings.length > 0
        ? [
            this.prisma.quizQuestionSkill.createMany({
              data: uniqueMappings.map((mapping) => ({
                questionId,
                skillId: mapping.skillId,
                weight: mapping.weight ?? 1,
              })),
            }),
          ]
        : []),
    ]);

    return this.prisma.quizQuestionSkill.findMany({
      where: { questionId },
      orderBy: { id: "asc" },
      include: { skill: true },
    });
  }

  async suggestQuestionSkillMappings(questionId: string) {
    const question = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!question) throw new NotFoundException("ไม่พบคำถามนี้");

    const skills = await this.prisma.positionSkill.findMany({
      where: { isActive: true, position: { isActive: true } },
      include: { position: true },
    });
    const skillById = new Map(skills.map((skill) => [skill.id, skill]));

    let candidates: SkillAnalysisCandidate[];
    try {
      candidates = (await this.analyzeQuestionSkillsWithAi(question.questionText, skills)).filter(
        (candidate) => candidate.confidence >= AI_CLASSIFIER_MIN_CONFIDENCE,
      );
    } catch (error) {
      this.logger.warn(`AI ล่ม: skill classifier unavailable while suggesting question skills: ${error}`);
      throw new BadRequestException("AI ล่ม กรุณาลองใหม่อีกครั้ง");
    }

    return candidates
      .slice(0, 5)
      .map((candidate) => {
        const skill = skillById.get(candidate.skillId);
        return {
          skillId: candidate.skillId,
          skillName: candidate.skillName,
          positionId: skill?.positionId ?? "",
          positionName: skill?.position.name ?? "",
          confidence: candidate.confidence,
          reason: candidate.reason,
          weight: 1,
        };
      });
  }

  private async resolvePosition(positionId?: string) {
    if (positionId) {
      const position = await this.prisma.position.findUnique({ where: { id: positionId } });
      if (!position || !position.isActive) throw new NotFoundException("ไม่พบตำแหน่งนี้");
      return position;
    }

    const defaultPosition = await this.prisma.position.findUnique({
      where: { name: DEFAULT_POSITION_NAME },
    });
    if (defaultPosition?.isActive) return defaultPosition;

    const firstPosition = await this.prisma.position.findFirst({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
    if (!firstPosition) throw new NotFoundException("ยังไม่มีตำแหน่งสำหรับ Skill Radar");
    return firstPosition;
  }

  private async resolveUserPosition(userId: string, requestedPositionId?: string) {
    if (requestedPositionId) return this.resolvePosition(requestedPositionId);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferredPosition: true },
    });

    if (user?.preferredPosition?.isActive) return user.preferredPosition;
    return this.resolvePosition();
  }
}
