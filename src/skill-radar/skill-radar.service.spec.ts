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
      count: jest.fn().mockResolvedValue(0),
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

describe("SkillRadarService Phase 9 admin analytics", () => {
  it("returns paginated admin skill score events with filters", async () => {
    const { service, prisma } = makeService();
    prisma.skillScoreEvent.findMany.mockResolvedValue([{ id: "event-1" }]);
    prisma.skillScoreEvent.count.mockResolvedValue(42);

    const result = await service.listAdminSkillScoreEvents({
      page: 2,
      limit: 10,
      userId: "user-1",
      positionId: "position-1",
      skillId: "skill-backend",
      sourceType: "AI_CHAT_QUESTION",
      search: "api",
    });

    expect(prisma.skillScoreEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
        skip: 10,
        where: expect.objectContaining({
          userId: "user-1",
          positionId: "position-1",
          skillId: "skill-backend",
          sourceType: "AI_CHAT_QUESTION",
          OR: expect.any(Array),
        }),
      }),
    );
    expect(prisma.skillScoreEvent.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: "user-1",
        positionId: "position-1",
        skillId: "skill-backend",
        sourceType: "AI_CHAT_QUESTION",
        OR: expect.any(Array),
      }),
    });
    expect(result).toEqual({
      items: [{ id: "event-1" }],
      total: 42,
      page: 2,
      limit: 10,
      totalPages: 5,
    });
  });
});

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

  it("records small interest-only score events from analyzed chat questions", async () => {
    const { service, prisma } = makeService();
    prisma.positionSkill.findMany.mockResolvedValue([
      makeSkill({ id: "skill-frontend", name: "FrontEnd", keywords: ["next.js", "ui", "mui"] }),
    ]);
    prisma.positionSkill.findUnique.mockResolvedValue({
      ...makeSkill({ id: "skill-frontend", name: "FrontEnd" }),
      position: { id: "position-1", isActive: true },
    });

    const events = await service.recordQuestionInterestSignal({
      userId: "user-1",
      source: "CHAT_QUESTION",
      sourceId: "message-1",
      question: "next.js ใช้ ant design หรือ mui ดีกว่ากันในการทำเว็บขายของ",
      analysis: {
        originalQuestion: "next.js ใช้ ant design หรือ mui ดีกว่ากันในการทำเว็บขายของ",
        interpretedQuestion: "Compare Ant Design and MUI for a Next.js ecommerce website",
        intent: "compare_ui_library",
        possibleSkills: [{ skillName: "FrontEnd", confidence: 0.8 }],
        keywords: ["Next.js", "Ant Design", "MUI"],
        difficultyGuess: "intermediate",
        questionQualityScore: 0.8,
      },
      recommendations: [
        {
          knowledgeBaseId: "kb-1",
          confidenceScore: 0.7,
          matchedSkills: ["FrontEnd"],
          reason: "UI library match",
          whyThisKBIsRelevant: "Related to frontend UI choices",
          shouldRecommend: true,
        },
      ],
    });

    expect(events).toHaveLength(1);
    expect(prisma.skillScoreEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        skillId: "skill-frontend",
        sourceType: "CHAT_QUESTION_INTEREST",
        sourceId: "message-1",
        scoreDelta: expect.any(Number),
        confidence: 0.8,
        reason: expect.stringContaining("Interest signal only"),
      }),
    });
    const eventData = prisma.skillScoreEvent.create.mock.calls[0][0].data;
    expect(eventData.scoreDelta).toBeGreaterThan(0);
    expect(eventData.scoreDelta).toBeLessThanOrEqual(1);
  });

  it("does not record interest score when question quality is too low", async () => {
    const { service, prisma } = makeService();

    const events = await service.recordQuestionInterestSignal({
      userId: "user-1",
      source: "CHAT_QUESTION",
      sourceId: "message-1",
      question: "ช่วยหน่อย",
      analysis: {
        originalQuestion: "ช่วยหน่อย",
        interpretedQuestion: "ช่วยหน่อย",
        intent: "unknown",
        possibleSkills: [{ skillName: "FrontEnd", confidence: 0.9 }],
        keywords: [],
        difficultyGuess: "unknown",
        questionQualityScore: 0.2,
      },
      recommendations: [],
    });

    expect(events).toEqual([]);
    expect(prisma.skillScoreEvent.create).not.toHaveBeenCalled();
    expect(prisma.userSkillScore.upsert).not.toHaveBeenCalled();
  });
});

describe("SkillRadarService Phase 7 lesson behavior scoring", () => {
  it("records small skill score events from lesson completion title and content signals", async () => {
    const { service, prisma } = makeService();
    prisma.positionSkill.findMany.mockResolvedValue([
      makeSkill({ id: "skill-backend", name: "BackEnd", keywords: ["api", "database", "auth"] }),
      makeSkill({ id: "skill-devops", name: "DevOps", keywords: ["docker", "deploy"] }),
    ]);

    const events = await service.recordLessonCompletionSkillSignals({
      userId: "user-1",
      lessonId: "lesson-1",
      lessonTitle: "API authentication with database",
      lessonContent: "This lesson explains auth flow, API routing, and database schema design.",
    });

    expect(events.length).toBeGreaterThan(0);
    expect(prisma.skillScoreEvent.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        sourceType: "LESSON_COMPLETION",
        sourceId: "lesson-1",
      },
      take: 1,
      select: { id: true },
    });
    expect(prisma.skillScoreEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        skillId: "skill-backend",
        sourceType: "LESSON_COMPLETION",
        sourceId: "lesson-1",
        scoreDelta: expect.any(Number),
        confidence: expect.any(Number),
        reason: expect.stringContaining("Lesson completion signal"),
      }),
    });
    const createArg = prisma.skillScoreEvent.create.mock.calls[0][0];
    expect(createArg.data.scoreDelta).toBeLessThanOrEqual(1.2);
  });

  it("does not record lesson completion score twice for the same user and lesson", async () => {
    const { service, prisma } = makeService();
    prisma.skillScoreEvent.findMany.mockResolvedValueOnce([{ id: "existing-event" }]);

    const events = await service.recordLessonCompletionSkillSignals({
      userId: "user-1",
      lessonId: "lesson-1",
      lessonTitle: "API authentication",
      lessonContent: "API auth database",
    });

    expect(events).toEqual([]);
    expect(prisma.positionSkill.findMany).not.toHaveBeenCalled();
    expect(prisma.skillScoreEvent.create).not.toHaveBeenCalled();
  });
});
