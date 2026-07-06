import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";
import { buildFingerprint, jaccardScore } from "../knowledge-base/text-similarity.util";
import type {
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
const AI_CHAT_MIN_CONFIDENCE = 0.2;
const AI_CHAT_MAX_SKILL_EVENTS = 3;
const AI_CHAT_MAX_SCORE_DELTA = 3;
const AI_CLASSIFIER_MIN_CONFIDENCE = 0.4;
const AI_CLASSIFIER_OPTIONS = { temperature: 0.1, maxTokens: 400 };
const ANTI_FARMING_WINDOW_HOURS = 24;
const AI_CHAT_DAILY_SKILL_EVENT_CAP = 8;
const AI_CHAT_DAILY_SKILL_SCORE_CAP = 15;
const SIMILAR_QUESTION_JACCARD_THRESHOLD = 0.5;
const SIMILAR_QUESTION_DECAY = 0.2;
const BUILT_IN_SKILL_KEYWORDS: Record<string, string[]> = {
  frontend: ["front end", "หน้าเว็บ", "หน้าจอ", "ปุ่ม", "ฟอร์ม", "responsive", "component"],
  backend: ["back end", "api", "ฐานข้อมูล", "ล็อกอิน", "login", "auth", "server"],
  devops: ["docker", "deploy", "deployment", "git", "merge", "workflow", "pipeline"],
  testing: ["test", "ทดสอบ", "bug", "error", "validation", "qa"],
  "system analysis": ["requirement", "workflow", "use case", "วิเคราะห์", "ออกแบบระบบ"],
  database: ["database", "ฐานข้อมูล", "sql", "postgres", "postgresql", "schema", "prisma", "query"],
  troubleshooting: ["troubleshoot", "แก้ปัญหา", "error", "diagnose", "fix"],
  networking: ["network", "ip", "dns", "wifi", "router"],
  hardware: ["hardware", "device", "printer", "pc", "laptop"],
  "operating systems": ["windows", "macos", "linux", "os"],
  "security basics": ["security", "password", "permission", "malware", "secure boot", "tpm"],
  "user research": ["research", "interview", "persona", "user need"],
  wireframing: ["wireframe", "flow", "layout", "structure"],
  "visual design": ["color", "typography", "visual", "spacing"],
  prototyping: ["prototype", "figma", "interaction", "mockup"],
  "design systems": ["design system", "component", "token", "style guide"],
};

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

  async listAdminSkillScoreEvents(limit = 30) {
    const take = Math.max(1, Math.min(limit, 100));
    return this.prisma.skillScoreEvent.findMany({
      take,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, name: true, email: true } },
        position: { select: { id: true, name: true } },
        skill: { select: { id: true, name: true } },
      },
    });
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

  private getSkillKeywords(skill: SkillRadarSkill): string[] {
    const skillName = skill.name.toLowerCase();
    const builtInKeywords = BUILT_IN_SKILL_KEYWORDS[skillName] ?? [];
    return Array.from(new Set([...skill.keywords, ...builtInKeywords, skill.name]));
  }

  analyzeQuestionSkills(question: string, skills: SkillRadarSkill[]): SkillAnalysisCandidate[] {
    const normalizedQuestion = this.normalizeForMatch(question);
    return skills
      .map((skill) => {
        const matchedKeywords = this.getSkillKeywords(skill).filter((keyword) =>
          normalizedQuestion.includes(this.normalizeForMatch(keyword)),
        );
        const confidence = Math.min(1, matchedKeywords.length * 0.2);
        return {
          skillId: skill.id,
          skillName: skill.name,
          confidence,
          reason:
            matchedKeywords.length > 0
              ? `Matched keywords: ${matchedKeywords.join(", ")}`
              : "No strong keyword match",
        };
      })
      .filter((candidate) => candidate.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);
  }

  private buildSkillClassifierPrompt(question: string, skills: SkillRadarSkill[]): string {
    const skillList = skills
      .map((skill) => `- id: ${skill.id} | name: ${skill.name}${skill.description ? ` | description: ${skill.description}` : ""}`)
      .join("\n");

    return [
      "You are a strict skill-classification engine for a learning platform.",
      "Given a learner's chat question, decide which of the following skills (if any) the question demonstrates knowledge of or interest in.",
      "You MUST only choose skillId values from this exact list — never invent a skillId:",
      skillList,
      "",
      `Learner question: "${question}"`,
      "",
      "Respond with ONLY a JSON array (no markdown, no explanation outside the JSON) of at most 3 items, each shaped exactly as:",
      '[{"skillId": "<id from the list above>", "confidence": <number between 0 and 1>, "reason": "<short reason in Thai or English>"}]',
      "If no skill from the list clearly applies, respond with an empty array: []",
    ].join("\n");
  }

  private parseSkillClassifierResponse(raw: string): Array<{ skillId: string; confidence: number; reason: string }> {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("AI classifier response did not contain a JSON array");

    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) throw new Error("AI classifier response JSON is not an array");

    return parsed;
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
      .filter((candidate) => candidate.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);
  }

  async recordQuestionSkillSignals(input: RecordQuestionSkillSignalsInput) {
    const question = input.question.trim();
    if (question.length < 3) return [];

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
    let usedAiClassifier = true;
    try {
      candidates = (await this.analyzeQuestionSkillsWithAi(question, skills)).filter(
        (candidate) => candidate.confidence >= AI_CLASSIFIER_MIN_CONFIDENCE,
      );
    } catch (error) {
      usedAiClassifier = false;
      this.logger.warn(`AI skill classifier failed, falling back to keyword matching: ${error}`);
      candidates = this.analyzeQuestionSkills(question, skills).filter(
        (candidate) => candidate.confidence >= AI_CHAT_MIN_CONFIDENCE,
      );
    }
    candidates = candidates.slice(0, AI_CHAT_MAX_SKILL_EVENTS);

    const events = [];
    for (const candidate of candidates) {
      const skill = skillById.get(candidate.skillId);
      const skillWeight = Math.min(skill?.weight ?? 1, 1.5);
      let scoreDelta =
        Math.round(
          Math.min(AI_CHAT_MAX_SCORE_DELTA, candidate.confidence * AI_CHAT_MAX_SCORE_DELTA * skillWeight) * 100,
        ) / 100;

      if (scoreDelta <= 0) continue;

      const antiFarming = await this.applyChatAntiFarmingAdjustment(
        input.userId,
        candidate.skillId,
        question,
        scoreDelta,
      );
      scoreDelta = antiFarming.scoreDelta;
      if (scoreDelta <= 0) continue;

      events.push(
        await this.recordSkillScoreEvent({
          userId: input.userId,
          skillId: candidate.skillId,
          sourceType: SKILL_SCORE_SOURCE_AI_CHAT_QUESTION,
          sourceId: input.sourceId ?? null,
          scoreDelta,
          confidence: candidate.confidence,
          reason: `AI chat question signal (${usedAiClassifier ? "ai-classifier" : "keyword-fallback"}): ${candidate.reason}${antiFarming.note ? ` | anti-farming: ${antiFarming.note}` : ""}`,
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
  ): Promise<{ scoreDelta: number; note: string | null }> {
    const since = new Date(Date.now() - ANTI_FARMING_WINDOW_HOURS * 60 * 60 * 1000);
    const recentEvents = await this.prisma.skillScoreEvent.findMany({
      where: {
        userId,
        skillId,
        sourceType: SKILL_SCORE_SOURCE_AI_CHAT_QUESTION,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { sourceId: true, scoreDelta: true },
    });

    if (recentEvents.length === 0) return { scoreDelta, note: null };

    const scoreSoFar = recentEvents.reduce((sum, event) => sum + event.scoreDelta, 0);
    if (recentEvents.length >= AI_CHAT_DAILY_SKILL_EVENT_CAP || scoreSoFar >= AI_CHAT_DAILY_SKILL_SCORE_CAP) {
      return { scoreDelta: 0, note: `daily cap reached (${recentEvents.length} events / ${scoreSoFar} pts in ${ANTI_FARMING_WINDOW_HOURS}h)` };
    }

    const recentSourceIds = recentEvents.map((event) => event.sourceId).filter((id): id is string => !!id);
    if (recentSourceIds.length > 0) {
      const recentMessages = await this.prisma.chatMessage.findMany({
        where: { id: { in: recentSourceIds } },
        select: { content: true },
      });
      const newFingerprint = buildFingerprint([question]);
      const isDuplicateTopic = recentMessages.some(
        (message) => jaccardScore(newFingerprint, buildFingerprint([message.content])) >= SIMILAR_QUESTION_JACCARD_THRESHOLD,
      );
      if (isDuplicateTopic) {
        const decayed = Math.round(scoreDelta * SIMILAR_QUESTION_DECAY * 100) / 100;
        return { scoreDelta: decayed, note: "similar to a recently asked question, score reduced" };
      }
    }

    const remainingBudget = AI_CHAT_DAILY_SKILL_SCORE_CAP - scoreSoFar;
    if (scoreDelta > remainingBudget) {
      return { scoreDelta: Math.max(0, Math.round(remainingBudget * 100) / 100), note: "capped to remaining daily budget" };
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
    if (!question) throw new NotFoundException("à¹„à¸¡à¹ˆà¸žà¸šà¸„à¸³à¸–à¸²à¸¡à¸™à¸µà¹‰");

    const skills = await this.prisma.positionSkill.findMany({
      where: { isActive: true, position: { isActive: true } },
      include: { position: true },
    });
    const skillById = new Map(skills.map((skill) => [skill.id, skill]));

    return this.analyzeQuestionSkills(question.questionText, skills)
      .filter((candidate) => candidate.confidence >= 0.2)
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
