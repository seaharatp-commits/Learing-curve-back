import { SkillRadarService } from "./skill-radar.service";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";

function makeSkill(overrides: Partial<any> = {}) {
  return {
    id: "skill-backend",
    positionId: "position-1",
    name: "BackEnd",
    description: "API, database, authentication",
    keywords: ["api", "database", "auth"],
    weight: 1,
    isActive: true,
    ...overrides,
  };
}

function makeService() {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        preferredPosition: { id: "position-1", name: "Software Engineer", isActive: true },
      }),
      update: jest.fn(),
    },
    position: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    positionSkill: {
      findMany: jest.fn().mockResolvedValue([makeSkill()]),
      findUnique: jest.fn().mockResolvedValue({
        ...makeSkill(),
        position: { id: "position-1", isActive: true },
      }),
      create: jest.fn(),
      update: jest.fn(),
    },
    skillScoreEvent: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockReturnValue({ id: "event-create" }),
    },
    userSkillScore: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockReturnValue({ id: "score-upsert" }),
    },
    chatMessage: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    quizQuestionSkill: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
    },
    question: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn().mockResolvedValue([{ id: "score-1" }, { id: "event-1" }]),
  };
  const aiService = { chat: jest.fn() };
  const service = new SkillRadarService(
    prisma as unknown as PrismaService,
    aiService as unknown as AiService,
  );
  return { service, prisma, aiService };
}

describe("SkillRadarService Phase 4/5 scoring", () => {
  it("does not treat short keywords as substring matches inside unrelated words", () => {
    const { service } = makeService();

    const result = service.analyzeQuestionSkills("What is capital budgeting?", [
      makeSkill({ id: "skill-api", name: "API", keywords: ["api"] }),
    ]);

    expect(result).toEqual([]);
  });

  it("records AI chat skill signals only for skills in the learner selected position", async () => {
    const { service, prisma, aiService } = makeService();
    prisma.positionSkill.findMany.mockResolvedValue([
      makeSkill({ id: "skill-backend", name: "BackEnd" }),
      makeSkill({ id: "skill-frontend", name: "FrontEnd", keywords: ["ui"] }),
    ]);
    aiService.chat.mockResolvedValue(
      JSON.stringify([
        { skillId: "skill-backend", confidence: 0.8, reason: "Question mentions API" },
        { skillId: "skill-other-position", confidence: 1, reason: "Should be ignored" },
      ]),
    );

    const events = await service.recordQuestionSkillSignals({
      userId: "user-1",
      question: "How should I design an API with database authentication?",
      sourceId: "message-1",
    });

    expect(events).toHaveLength(1);
    expect(prisma.positionSkill.findMany).toHaveBeenCalledWith({
      where: { positionId: "position-1", isActive: true, position: { isActive: true } },
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
    expect(prisma.skillScoreEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        skillId: "skill-backend",
        sourceType: "AI_CHAT_QUESTION",
        confidence: 0.8,
      }),
    });
  });

  it("falls back to keyword matching when the AI classifier fails", async () => {
    const { service, prisma, aiService } = makeService();
    aiService.chat.mockRejectedValue(new Error("AI down"));

    const events = await service.recordQuestionSkillSignals({
      userId: "user-1",
      question: "How do I design an API database auth flow?",
      sourceId: "message-1",
    });

    expect(events).toHaveLength(1);
    expect(prisma.skillScoreEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        skillId: "skill-backend",
        sourceType: "AI_CHAT_QUESTION",
        reason: expect.stringContaining("keyword-fallback"),
      }),
    });
  });

  it("does not record more AI chat score events after the daily user cap is reached", async () => {
    const { service, prisma, aiService } = makeService();
    aiService.chat.mockResolvedValue(
      JSON.stringify([{ skillId: "skill-backend", confidence: 0.8, reason: "Question mentions API" }]),
    );
    prisma.skillScoreEvent.findMany.mockResolvedValue(
      Array.from({ length: 25 }, (_, index) => ({
        sourceId: `message-${index}`,
        scoreDelta: 1,
        skillId: index % 2 === 0 ? "skill-backend" : "skill-frontend",
      })),
    );

    const events = await service.recordQuestionSkillSignals({
      userId: "user-1",
      question: "How should I design an API with database authentication?",
      sourceId: "message-new",
    });

    expect(events).toEqual([]);
    expect(prisma.skillScoreEvent.create).not.toHaveBeenCalled();
    expect(prisma.userSkillScore.upsert).not.toHaveBeenCalled();
  });
});
