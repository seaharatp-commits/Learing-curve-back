import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type {
  RecordSkillScoreEventInput,
  SkillAnalysisCandidate,
  SkillRadarPosition,
  SkillRadarSkill,
  UserSkillRadar,
} from "./skill-radar.types";

const DEFAULT_POSITION_NAME = "Software Engineer";

@Injectable()
export class SkillRadarService {
  constructor(private readonly prisma: PrismaService) {}

  async listPositions(): Promise<SkillRadarPosition[]> {
    return this.prisma.position.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, description: true, isActive: true },
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

  async getUserRadar(userId: string, positionId?: string): Promise<UserSkillRadar> {
    const position = await this.resolvePosition(positionId);
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

  analyzeQuestionSkills(question: string, skills: SkillRadarSkill[]): SkillAnalysisCandidate[] {
    const normalizedQuestion = question.toLowerCase();
    return skills
      .map((skill) => {
        const matchedKeywords = skill.keywords.filter((keyword) =>
          normalizedQuestion.includes(keyword.toLowerCase()),
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
}
