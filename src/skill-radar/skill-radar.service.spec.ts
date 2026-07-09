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
    careerAlignment: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn((args) => Promise.resolve({ id: "ca-1", ...args.create, ...args.update })),
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

  it("records no skill signal (no keyword fallback) when the AI classifier is down", async () => {
    const { service, prisma, aiService } = makeService();
    aiService.chat.mockRejectedValue(new Error("AI down"));

    const events = await service.recordQuestionSkillSignals({
      userId: "user-1",
      question: "How do I design an API database auth flow?",
      sourceId: "message-1",
    });

    expect(events).toEqual([]);
    expect(prisma.skillScoreEvent.create).not.toHaveBeenCalled();
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

  it("awards a full point when quality x confidence is strong, and half a point otherwise", async () => {
    const { service, prisma } = makeService();
    prisma.positionSkill.findMany.mockResolvedValue([
      makeSkill({ id: "skill-frontend", name: "FrontEnd", keywords: [] }),
    ]);
    prisma.positionSkill.findUnique.mockResolvedValue({
      ...makeSkill({ id: "skill-frontend", name: "FrontEnd" }),
      position: { id: "position-1", isActive: true },
    });

    const strongEvents = await service.recordQuestionInterestSignal({
      userId: "user-1",
      source: "CHAT_QUESTION",
      sourceId: "message-strong",
      question: "React radar chart dashboard",
      analysis: {
        originalQuestion: "q",
        interpretedQuestion: "q",
        intent: "unknown",
        possibleSkills: [{ skillName: "FrontEnd", confidence: 0.9 }],
        keywords: [],
        difficultyGuess: "unknown",
        questionQualityScore: 0.9,
      },
      recommendations: [],
    });
    expect(strongEvents).toHaveLength(1);
    expect(prisma.skillScoreEvent.create.mock.calls[0][0].data.scoreDelta).toBe(1);

    prisma.skillScoreEvent.create.mockClear();
    const weakEvents = await service.recordQuestionInterestSignal({
      userId: "user-1",
      source: "CHAT_QUESTION",
      sourceId: "message-weak",
      question: "React radar chart dashboard weak",
      analysis: {
        originalQuestion: "q",
        interpretedQuestion: "q",
        intent: "unknown",
        possibleSkills: [{ skillName: "FrontEnd", confidence: 0.5 }],
        keywords: [],
        difficultyGuess: "unknown",
        questionQualityScore: 0.5,
      },
      recommendations: [],
    });
    expect(weakEvents).toHaveLength(1);
    expect(prisma.skillScoreEvent.create.mock.calls[0][0].data.scoreDelta).toBe(0.5);
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
    const { service, prisma, aiService } = makeService();
    prisma.positionSkill.findMany.mockResolvedValue([
      makeSkill({ id: "skill-backend", name: "BackEnd", keywords: ["api", "database", "auth"] }),
      makeSkill({ id: "skill-devops", name: "DevOps", keywords: ["docker", "deploy"] }),
    ]);
    aiService.chat.mockResolvedValue(
      JSON.stringify([{ skillId: "skill-backend", confidence: 0.7, reason: "Lesson covers API auth and database" }]),
    );

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

describe("SkillRadarService.getCareerAlignment", () => {
  function alignmentService() {
    const { service, prisma, aiService } = makeService();
    prisma.position.findUnique.mockResolvedValue({ id: "position-1", name: "Software Engineer", isActive: true });
    // getUserRadar reads positionSkill.findMany with userSkillScores included.
    // getUserRadar rounds scores, so radar skills are s1:70, s2:60, s3:0.
    prisma.positionSkill.findMany.mockResolvedValue([
      { id: "s1", name: "FrontEnd", description: null, userSkillScores: [{ score: 70, evidenceCount: 5 }] },
      { id: "s2", name: "BackEnd", description: null, userSkillScores: [{ score: 60, evidenceCount: 4 }] },
      { id: "s3", name: "DevOps", description: null, userSkillScores: [] },
    ]);
    const aiJson = JSON.stringify({
      description: "เส้นทางสาย Software Engineer ของคุณไปได้สวยเลยค่ะ",
      quotes: ["เริ่มวันนี้ เก่งขึ้นได้ทุกวัน", "ก้าวเล็ก ๆ วันนี้ คือฐานของวันพรุ่งนี้"],
      nextSteps: ["ทำ quiz เพิ่ม", "เรียนหัวข้อใหม่"],
    });
    return { service, prisma, aiService, aiJson };
  }

  it("computes level/strengths deterministically and generates+caches content on first load", async () => {
    const { service, prisma, aiService, aiJson } = alignmentService();
    aiService.chat.mockResolvedValue(aiJson);

    const result = await service.getCareerAlignment("user-1");

    expect(result.position).toBe("Software Engineer");
    // avg(70,60)=65, breadth 2/3=0.667 -> 65*(0.6+0.4*0.667)=56.33 -> Junior Strong
    expect(result.level).toBe("Junior Strong");
    expect(result.strengths).toEqual(["FrontEnd", "BackEnd"]);
    expect(result.description).toContain("Software Engineer");
    expect(result.quotes).toEqual(["เริ่มวันนี้ เก่งขึ้นได้ทุกวัน", "ก้าวเล็ก ๆ วันนี้ คือฐานของวันพรุ่งนี้"]);
    expect(result.nextSteps).toEqual(["ทำ quiz เพิ่ม", "เรียนหัวข้อใหม่"]);
    expect(result.generatedBy).toBe("ai");
    // Persisted with the skill-score hash + snapshot for later cache checks.
    const upsertArg = prisma.careerAlignment.upsert.mock.calls[0][0];
    expect(upsertArg.where).toEqual({ userId_positionId: { userId: "user-1", positionId: "position-1" } });
    expect(upsertArg.create.skillScoreHash).toBe("s1:70|s2:60|s3:0");
    expect(upsertArg.create.scoreSumSnapshot).toBe(130);
    expect(upsertArg.create.quotes).toEqual(["เริ่มวันนี้ เก่งขึ้นได้ทุกวัน", "ก้าวเล็ก ๆ วันนี้ คือฐานของวันพรุ่งนี้"]);
    expect(upsertArg.create.generatedBy).toBe("ai");
    expect(aiService.chat.mock.calls[0][0][0].content).toContain("Use ONLY strengths, quotes, description, and nextSteps");
    expect(aiService.chat.mock.calls[0][0][0].content).toContain("quotes: 2-4 short Thai motivational quotes");
    expect(aiService.chat.mock.calls[0][0][0].content).toContain("Do NOT output or imply weaknesses");
    expect(aiService.chat.mock.calls[0][0][0].content).toContain("NEVER make the learner feel judged");
  });

  it("returns the cached row WITHOUT calling the AI when the skill-score hash is unchanged", async () => {
    const { service, prisma, aiService } = alignmentService();
    prisma.careerAlignment.findUnique.mockResolvedValue({
      skillScoreHash: "s1:70|s2:60|s3:0", // matches current radar
      level: "Junior Strong",
      alignmentScore: 56.33,
      strengths: ["FrontEnd", "BackEnd"],
      description: "cached description",
      quotes: ["cached quote"],
      nextSteps: ["cached step"],
      generatedBy: "ai",
    });

    const result = await service.getCareerAlignment("user-1");

    expect(aiService.chat).not.toHaveBeenCalled();
    expect(prisma.careerAlignment.upsert).not.toHaveBeenCalled();
    expect(result.description).toBe("cached description");
    expect(result.quotes).toEqual(["cached quote"]);
    expect(result.nextSteps).toEqual(["cached step"]);
  });

  it("regenerates with the AI and updates the row when the skill-score hash changed", async () => {
    const { service, prisma, aiService, aiJson } = alignmentService();
    aiService.chat.mockResolvedValue(aiJson);
    prisma.careerAlignment.findUnique.mockResolvedValue({
      skillScoreHash: "s1:40|s2:60|s3:0", // stale — FrontEnd used to be 40
      level: "Junior",
      alignmentScore: 40,
      strengths: ["BackEnd"],
      description: "old cached description",
      quotes: ["old quote"],
      nextSteps: [],
      generatedBy: "ai",
    });

    const result = await service.getCareerAlignment("user-1");

    expect(aiService.chat).toHaveBeenCalledTimes(1);
    expect(prisma.careerAlignment.upsert).toHaveBeenCalledTimes(1);
    const upsertArg = prisma.careerAlignment.upsert.mock.calls[0][0];
    expect(upsertArg.update.skillScoreHash).toBe("s1:70|s2:60|s3:0");
    expect(upsertArg.update.quotes).toEqual(["เริ่มวันนี้ เก่งขึ้นได้ทุกวัน", "ก้าวเล็ก ๆ วันนี้ คือฐานของวันพรุ่งนี้"]);
    expect(result.description).toContain("Software Engineer");
  });

  it("saves fallback content with generatedBy 'fallback' when the AI Center fails", async () => {
    const { service, prisma, aiService } = alignmentService();
    aiService.chat.mockRejectedValue(new Error("AI down"));

    const result = await service.getCareerAlignment("user-1");

    expect(result.level).toBe("Junior Strong");
    expect(result.generatedBy).toBe("fallback");
    expect(result.description).toContain("Software Engineer");
    expect(result.description).toContain("FrontEnd");
    expect(result.quotes.length).toBeGreaterThan(0);
    expect(result.nextSteps.length).toBeGreaterThan(0);
    expect(prisma.careerAlignment.upsert.mock.calls[0][0].create.generatedBy).toBe("fallback");
  });

  it("returns Getting Started with fallback and does not call the AI when there is no evidence yet", async () => {
    const { service, prisma, aiService } = alignmentService();
    prisma.positionSkill.findMany.mockResolvedValue([
      { id: "s1", name: "FrontEnd", description: null, userSkillScores: [] },
      { id: "s2", name: "BackEnd", description: null, userSkillScores: [{ score: 0, evidenceCount: 0 }] },
    ]);

    const result = await service.getCareerAlignment("user-1");

    expect(result.level).toBe("Getting Started");
    expect(result.strengths).toEqual([]);
    expect(result.generatedBy).toBe("fallback");
    expect(result.quotes.length).toBeGreaterThan(0);
    expect(aiService.chat).not.toHaveBeenCalled();
    // Still cached so subsequent loads are cheap.
    expect(prisma.careerAlignment.upsert).toHaveBeenCalledTimes(1);
  });
});
