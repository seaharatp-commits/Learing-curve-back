import { BadRequestException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { QuizService } from "./quiz.service";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";
import { AiQuestionUnderstandingService } from "../ai/ai-question-understanding.service";
import type { RequestUser } from "../auth/strategies/jwt.strategy";
import { RecommendationService } from "../knowledge-base/recommendation.service";
import { SkillRadarService } from "../skill-radar/skill-radar.service";

const user: RequestUser = { id: "user-1", email: "user@example.com", role: "USER" };

const VALID_QUESTIONS_JSON = JSON.stringify({
  questions: [
    {
      question: "ข้อ 1?",
      options: ["A", "B", "C", "D"],
      correctIndex: 1,
      explanation: "เพราะ B ถูก",
    },
    {
      question: "ข้อ 2?",
      options: ["A", "B", "C", "D"],
      correctIndex: 0,
      explanation: "เพราะ A ถูก",
    },
  ],
});

const VALID_TOPIC_JSON = JSON.stringify({
  title: "พื้นฐานความปลอดภัยของรหัสผ่าน",
  content: "รหัสผ่านที่ดีควรเดายากและไม่ใช้ซ้ำ\n\nควรใช้ตัวจัดการรหัสผ่านเมื่อต้องจำหลายบัญชี",
  questions: [
    {
      question: "ข้อใดเป็นแนวทางที่ดี?",
      options: ["ใช้ซ้ำทุกเว็บ", "ใช้วันเกิด", "ใช้ตัวจัดการรหัสผ่าน", "บอกเพื่อน"],
      correctIndex: 2,
      explanation: "ตัวจัดการรหัสผ่านช่วยสร้างและจำรหัสผ่านที่ซับซ้อน",
    },
  ],
});

function makeService() {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: "user-1" }) },
    knowledgeBaseArticle: { findUnique: jest.fn() },
    lesson: { aggregate: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
    quiz: { create: jest.fn(), delete: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    quizAttempt: { create: jest.fn(), findMany: jest.fn() },
  };
  const aiService = { chat: jest.fn() };
  const aiQuestionUnderstandingService = {
    analyzeQuestion: jest.fn().mockResolvedValue({
      originalQuestion: "What next?",
      interpretedQuestion: "What should I learn next?",
      intent: "lesson_follow_up",
      possibleSkills: [{ skillName: "BackEnd", confidence: 0.7 }],
      keywords: ["lesson"],
      difficultyGuess: "unknown",
      questionQualityScore: 0.7,
    }),
  };
  const recommendationService = {
    searchCandidates: jest.fn().mockResolvedValue([]),
    rerankCandidates: jest.fn().mockResolvedValue([]),
  };
  const skillRadarService = {
    recordQuestionSkillSignals: jest.fn().mockResolvedValue([]),
    recordQuestionInterestSignal: jest.fn().mockResolvedValue([]),
    analyzeUserTextSkills: jest.fn().mockResolvedValue({ candidates: [], usedAiClassifier: false }),
    listSkillNamesForUser: jest.fn().mockResolvedValue([]),
    getSkillScoreState: jest.fn().mockResolvedValue({
      score: 0,
      confidence: 0.5,
      evidenceCount: 0,
      wrongStreak: 0,
      masteryPoint: 0,
    }),
    persistSkillScoreResult: jest.fn(),
  };
  const service = new QuizService(
    prisma as unknown as PrismaService,
    aiService as unknown as AiService,
    aiQuestionUnderstandingService as unknown as AiQuestionUnderstandingService,
    recommendationService as unknown as RecommendationService,
    skillRadarService as unknown as SkillRadarService,
  );
  return { service, prisma, aiService, aiQuestionUnderstandingService, recommendationService, skillRadarService };
}

describe("QuizService.generateFromArticle", () => {
  it("throws NotFoundException when the article does not exist", async () => {
    const { service, prisma } = makeService();
    prisma.knowledgeBaseArticle.findUnique.mockResolvedValue(null);

    await expect(service.generateFromArticle(user, "missing")).rejects.toThrow(NotFoundException);
  });

  it("rejects articles whose content is too short to generate truthful questions from", async () => {
    const { service, prisma, aiService } = makeService();
    prisma.knowledgeBaseArticle.findUnique.mockResolvedValue({
      id: "kb-1",
      title: "Short article",
      content: "too short",
    });

    await expect(service.generateFromArticle(user, "kb-1")).rejects.toThrow(BadRequestException);
    expect(aiService.chat).not.toHaveBeenCalled();
  });

  it("creates a quiz with parsed questions from a valid AI response", async () => {
    const { service, prisma, aiService } = makeService();
    prisma.knowledgeBaseArticle.findUnique.mockResolvedValue({
      id: "kb-1",
      title: "วิธีรีเซ็ตรหัสผ่าน",
      content: "เนื้อหาทดสอบที่มีความยาวเพียงพอสำหรับสร้างแบบทดสอบจริง",
    });
    aiService.chat.mockResolvedValue(VALID_QUESTIONS_JSON);
    prisma.quiz.create.mockResolvedValue({ id: "quiz-1", questions: [{}, {}] });

    const result = await service.generateFromArticle(user, "kb-1");

    expect(result.id).toBe("quiz-1");
    const createArgs = prisma.quiz.create.mock.calls[0][0];
    expect(createArgs.data.createdByUserId).toBe("user-1");
    expect(createArgs.data.sourceArticleId).toBe("kb-1");
    expect(createArgs.data.questions.create).toHaveLength(2);
    expect(createArgs.data.questions.create[0]).toEqual({
      questionText: "ข้อ 1?",
      options: ["A", "B", "C", "D"],
      correctIndex: 1,
      explanation: "เพราะ B ถูก",
    });
  });

  it("rejects malformed AI responses (e.g. missing options) instead of saving garbage", async () => {
    const { service, prisma, aiService } = makeService();
    prisma.knowledgeBaseArticle.findUnique.mockResolvedValue({ id: "kb-1", title: "x", content: "เนื้อหาทดสอบที่มีความยาวเพียงพอสำหรับสร้างแบบทดสอบจริง" });
    aiService.chat.mockResolvedValue(JSON.stringify({ questions: [{ question: "no options" }] }));

    await expect(service.generateFromArticle(user, "kb-1")).rejects.toThrow(BadRequestException);
    expect(prisma.quiz.create).not.toHaveBeenCalled();
  });

  it("recovers from a trailing comma (real failure seen from the AI gateway)", async () => {
    const { service, prisma, aiService } = makeService();
    prisma.knowledgeBaseArticle.findUnique.mockResolvedValue({ id: "kb-1", title: "x", content: "เนื้อหาทดสอบที่มีความยาวเพียงพอสำหรับสร้างแบบทดสอบจริง" });
    // Strips the closing brace's trailing comma that breaks JSON.parse.
    const withTrailingComma = VALID_QUESTIONS_JSON.replace(/\]\}$/, "],}");
    aiService.chat.mockResolvedValue(withTrailingComma);
    prisma.quiz.create.mockResolvedValue({ id: "quiz-1", questions: [{}, {}] });

    const result = await service.generateFromArticle(user, "kb-1");
    expect(result.id).toBe("quiz-1");
  });

  it("throws BadRequestException when the AI response is unrecoverably broken", async () => {
    const { service, prisma, aiService } = makeService();
    prisma.knowledgeBaseArticle.findUnique.mockResolvedValue({ id: "kb-1", title: "x", content: "เนื้อหาทดสอบที่มีความยาวเพียงพอสำหรับสร้างแบบทดสอบจริง" });
    aiService.chat.mockResolvedValue('{"questions": [{"question": "unterminated string]}');

    await expect(service.generateFromArticle(user, "kb-1")).rejects.toThrow(BadRequestException);
    expect(prisma.quiz.create).not.toHaveBeenCalled();
  });

  it("retries the AI gateway after a flaky malformed response and succeeds on a later attempt", async () => {
    const { service, prisma, aiService } = makeService();
    prisma.knowledgeBaseArticle.findUnique.mockResolvedValue({
      id: "kb-1",
      title: "วิธีรีเซ็ตรหัสผ่าน",
      content: "เนื้อหาทดสอบที่มีความยาวเพียงพอสำหรับสร้างแบบทดสอบจริง",
    });
    aiService.chat
      .mockResolvedValueOnce('{"questions": [{"question": "unterminated string]}')
      .mockResolvedValueOnce(VALID_QUESTIONS_JSON);
    prisma.quiz.create.mockResolvedValue({ id: "quiz-1", questions: [{}, {}] });

    const result = await service.generateFromArticle(user, "kb-1");

    expect(result.id).toBe("quiz-1");
    expect(aiService.chat).toHaveBeenCalledTimes(2);
  });
});

describe("QuizService.generateFromTopic", () => {
  it("creates a lesson without creating a quiz from a free-form topic", async () => {
    const { service, prisma, aiService, skillRadarService } = makeService();
    aiService.chat.mockResolvedValue(VALID_TOPIC_JSON);
    prisma.lesson.aggregate.mockResolvedValue({ _max: { order: 4 } });
    prisma.lesson.create.mockResolvedValue({
      id: "lesson-1",
      title: "พื้นฐานความปลอดภัยของรหัสผ่าน",
    });

    const result = await service.generateFromTopic(user, "รหัสผ่านปลอดภัย");

    expect(result).toEqual({
      lessonId: "lesson-1",
      quizId: null,
      title: "พื้นฐานความปลอดภัยของรหัสผ่าน",
    });
    expect(aiService.chat).toHaveBeenCalledWith(expect.any(Array), {
      temperature: 0.6,
      maxTokens: 1800,
    });
    expect(prisma.lesson.create).toHaveBeenCalledWith({
      data: {
        title: "พื้นฐานความปลอดภัยของรหัสผ่าน",
        createdByUserId: "user-1",
        content: "รหัสผ่านที่ดีควรเดายากและไม่ใช้ซ้ำ\n\nควรใช้ตัวจัดการรหัสผ่านเมื่อต้องจำหลายบัญชี",
        order: 5,
      },
    });
    expect(prisma.quiz.create).not.toHaveBeenCalled();
    expect(skillRadarService.recordQuestionSkillSignals).toHaveBeenCalledWith({
      userId: "user-1",
      question: expect.any(String),
      sourceId: "lesson-1",
      sourceType: "LESSON_TOPIC_CREATED",
      maxScoreDelta: 1,
      maxSkillEvents: 2,
      reasonPrefix: "Lesson topic creation signal",
    });
  });

  it("creates a lesson from a plain-text AI response when JSON is missing", async () => {
    const { service, prisma, aiService } = makeService();
    aiService.chat.mockResolvedValue(
      "This is a plain lesson response that is long enough to be saved when the AI ignores JSON formatting.",
    );
    prisma.lesson.aggregate.mockResolvedValue({ _max: { order: 0 } });
    prisma.lesson.create.mockResolvedValue({
      id: "lesson-plain",
      title: "Plain topic",
    });

    const result = await service.generateFromTopic(user, "Plain topic");

    expect(result).toEqual({ lessonId: "lesson-plain", quizId: null, title: "Plain topic" });
    expect(prisma.lesson.create).toHaveBeenCalledWith({
      data: {
        title: "Plain topic",
        createdByUserId: "user-1",
        content:
          "This is a plain lesson response that is long enough to be saved when the AI ignores JSON formatting.",
        order: 1,
      },
    });
  });

  it("unwraps a double-encoded JSON content field instead of saving raw JSON", async () => {
    const { service, prisma, aiService } = makeService();
    aiService.chat.mockResolvedValue(
      JSON.stringify({
        title: "พื้นฐานความปลอดภัยของรหัสผ่าน",
        content: JSON.stringify({
          title: "พื้นฐานความปลอดภัยของรหัสผ่าน",
          content: "รหัสผ่านที่ดีควรเดายากและไม่ใช้ซ้ำ\n\nควรใช้ตัวจัดการรหัสผ่านเมื่อต้องจำหลายบัญชี",
        }),
      }),
    );
    prisma.lesson.aggregate.mockResolvedValue({ _max: { order: 4 } });
    prisma.lesson.create.mockResolvedValue({
      id: "lesson-1",
      title: "พื้นฐานความปลอดภัยของรหัสผ่าน",
    });

    await service.generateFromTopic(user, "รหัสผ่านปลอดภัย");

    expect(prisma.lesson.create).toHaveBeenCalledWith({
      data: {
        title: "พื้นฐานความปลอดภัยของรหัสผ่าน",
        createdByUserId: "user-1",
        content: "รหัสผ่านที่ดีควรเดายากและไม่ใช้ซ้ำ\n\nควรใช้ตัวจัดการรหัสผ่านเมื่อต้องจำหลายบัญชี",
        order: 5,
      },
    });
  });

  it("returns ServiceUnavailableException without saving a lesson when the AI gateway is temporarily down", async () => {
    const { service, prisma, aiService } = makeService();
    aiService.chat.mockRejectedValue({ response: { status: 502 } });

    await expect(service.generateFromTopic(user, "AI gateway failure")).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(aiService.chat).toHaveBeenCalledTimes(3);
    expect(prisma.lesson.create).not.toHaveBeenCalled();
  });
});

describe("QuizService.askLessonQuestion", () => {
  it("answers a learner question using the lesson and chat history", async () => {
    const { service, prisma, aiService, skillRadarService } = makeService();
    prisma.lesson.findUnique.mockResolvedValue({
      id: "lesson-1",
      title: "Lesson 1",
      content: "Lesson content",
      createdByUserId: "user-1",
    });
    aiService.chat.mockResolvedValue("Answer from lesson");

    const result = await service.askLessonQuestion(user, "lesson-1", "What next?", "ผู้เรียน: hi");

    expect(result).toEqual({ answer: "Answer from lesson", recommendedKnowledgeBases: [] });
    expect(aiService.chat).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining("What next?") }),
      ]),
      { temperature: 0.5, maxTokens: 1000 },
    );
    expect(skillRadarService.recordQuestionInterestSignal).toHaveBeenCalledWith({
      userId: "user-1",
      source: "LESSON_CHAT_QUESTION",
      question: "What next?",
      sourceId: expect.stringMatching(/^lesson-chat:lesson-1:/),
      analysis: expect.objectContaining({
        interpretedQuestion: "What should I learn next?",
      }),
      recommendations: [],
    });
  });

  it("normalizes a JSON-shaped lesson chat answer before returning it to the UI", async () => {
    const { service, prisma, aiService } = makeService();
    prisma.lesson.findUnique.mockResolvedValue({
      id: "lesson-1",
      title: "Lesson 1",
      content: "Lesson content",
      createdByUserId: "user-1",
    });
    aiService.chat.mockResolvedValue(
      JSON.stringify({
        title: "สรุปแบบเข้าใจง่าย",
        content: "เนื้อหาคำตอบที่ผู้เรียนควรเห็นค่ะ",
      }),
    );

    const result = await service.askLessonQuestion(user, "lesson-1", "Explain simply");

    expect(result.answer).toContain("## ");
    expect(result.answer).toContain("\n\n");
    expect(result.recommendedKnowledgeBases).toEqual([]);
  });

  it("returns optional recommended Knowledge Bases for lesson chat", async () => {
    const { service, prisma, aiService, recommendationService } = makeService();
    prisma.lesson.findUnique.mockResolvedValue({
      id: "lesson-1",
      title: "Lesson 1",
      content: "Lesson content about merge workflow",
      createdByUserId: "user-1",
    });
    aiService.chat.mockResolvedValue("Answer from lesson");
    recommendationService.searchCandidates.mockResolvedValue([
      {
        id: "kb-1",
        title: "Merge workflow",
        summary: "Merge workflow summary",
        tags: ["git"],
        relatedSkills: ["DevOps"],
        contentPreview: "Merge workflow preview",
        databaseRelevanceScore: 0.5,
      },
    ]);
    recommendationService.rerankCandidates.mockResolvedValue([
      {
        knowledgeBaseId: "kb-1",
        confidenceScore: 0.8,
        matchedSkills: ["DevOps"],
        reason: "Related to merge workflow",
        whyThisKBIsRelevant: "The lesson question mentions merge workflow",
        shouldRecommend: true,
      },
    ]);

    const result = await service.askLessonQuestion(user, "lesson-1", "How do I resolve merge conflict?");

    expect(result.recommendedKnowledgeBases).toEqual([
      {
        articleId: "kb-1",
        title: "Merge workflow",
        preview: "Merge workflow preview",
        summary: "Merge workflow summary",
        confidenceScore: 0.8,
        matchedSkills: ["DevOps"],
        reason: "Related to merge workflow",
        whyThisKBIsRelevant: "The lesson question mentions merge workflow",
        shouldRecommend: true,
      },
    ]);
  });
});

describe("QuizService.generateQuizFromLesson", () => {
  it("creates a quiz from lesson content and the latest additional prompt", async () => {
    const { service, prisma, aiService } = makeService();
    prisma.lesson.findUnique.mockResolvedValue({
      id: "lesson-1",
      title: "Lesson 1",
      content: "This lesson content is long enough to generate a useful assessment for the learner.",
      createdByUserId: "user-1",
    });
    aiService.chat.mockResolvedValue(VALID_QUESTIONS_JSON);
    prisma.quiz.create.mockResolvedValue({ id: "quiz-1", title: "แบบทดสอบ: Lesson 1" });

    const result = await service.generateQuizFromLesson(user, "lesson-1", "focus on examples");

    expect(result).toEqual({ quizId: "quiz-1", title: "แบบทดสอบ: Lesson 1" });
    expect(aiService.chat).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining("focus on examples") }),
      ]),
      { temperature: 0.4, maxTokens: 1400 },
    );
    expect(prisma.quiz.create).toHaveBeenCalledWith({
      data: {
        title: expect.any(String),
        createdByUserId: "user-1",
        lessonId: "lesson-1",
        questions: {
          create: [
            {
              questionText: "ข้อ 1?",
              options: ["A", "B", "C", "D"],
              correctIndex: 1,
              explanation: "เพราะ B ถูก",
            },
            {
              questionText: "ข้อ 2?",
              options: ["A", "B", "C", "D"],
              correctIndex: 0,
              explanation: "เพราะ A ถูก",
            },
          ],
        },
      },
    });
  });
});

describe("QuizService.submitAttempt", () => {
  it("throws NotFoundException for a missing quiz", async () => {
    const { service, prisma } = makeService();
    prisma.quiz.findUnique.mockResolvedValue(null);

    await expect(service.submitAttempt(user, "missing", { answers: [] })).rejects.toThrow(
      NotFoundException,
    );
  });

  it("scores answers correctly when every quiz question has one valid answer", async () => {
    const { service, prisma, skillRadarService } = makeService();
    prisma.quiz.findUnique.mockResolvedValue({
      id: "quiz-1",
      createdByUserId: "user-1",
      lessonId: "lesson-1",
      questions: [
        { id: "q1", questionText: "Question 1", correctIndex: 1, explanation: "exp1", options: ["a", "b", "c", "d"] },
        { id: "q2", questionText: "Question 2", correctIndex: 0, explanation: "exp2", options: ["a", "b", "c", "d"] },
      ],
    });
    const submittedAt = new Date("2026-07-06T09:00:00.000Z");
    prisma.quizAttempt.create.mockResolvedValue({ id: "attempt-1", submittedAt });

    const result = await service.submitAttempt(user, "quiz-1", {
      answers: [
        { questionId: "q1", selectedIndex: 1 }, // correct
        { questionId: "q2", selectedIndex: 2 }, // wrong
      ],
    });

    expect(result.correctCount).toBe(1);
    expect(result.totalQuestions).toBe(2);
    expect(result.score).toBe(50);
    expect(result.answers).toHaveLength(2);
    expect(result.submittedAt).toEqual(submittedAt);
    expect(prisma.quizAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        quizId: "quiz-1",
        lessonId: "lesson-1",
        score: 50,
        selectedAnswers: expect.any(Array),
        correctAnswers: expect.any(Array),
        result: expect.objectContaining({ score: 50, totalQuestions: 2, correctCount: 1 }),
        submittedAt: expect.any(Date),
        completedAt: expect.any(Date),
      }),
    });
    expect(skillRadarService.persistSkillScoreResult).not.toHaveBeenCalled();
  });

  it("updates mapped skill scores after a successful quiz attempt", async () => {
    const { service, prisma, skillRadarService } = makeService();
    prisma.quiz.findUnique.mockResolvedValue({
      id: "quiz-1",
      createdByUserId: "user-1",
      lessonId: "lesson-1",
      questions: [
        {
          id: "q1",
          questionText: "Question 1",
          correctIndex: 1,
          explanation: "exp1",
          options: ["a", "b", "c", "d"],
          skillMappings: [
            { skillId: "skill-backend", weight: 1, skill: { name: "BackEnd", weight: 1 } },
          ],
        },
        {
          id: "q2",
          questionText: "Question 2",
          correctIndex: 0,
          explanation: "exp2",
          options: ["a", "b", "c", "d"],
          skillMappings: [
            { skillId: "skill-backend", weight: 1, skill: { name: "BackEnd", weight: 1 } },
          ],
        },
      ],
    });
    prisma.quizAttempt.create.mockResolvedValue({
      id: "attempt-1",
      submittedAt: new Date("2026-07-06T09:00:00.000Z"),
    });

    await service.submitAttempt(user, "quiz-1", {
      answers: [
        { questionId: "q1", selectedIndex: 1 },
        { questionId: "q2", selectedIndex: 2 },
      ],
    });

    // Processing is sequential per answer now (not aggregated into one flat
    // delta), because diminishing return / wrong-streak both depend on state
    // at the moment of each event: q1 (correct) earns a full diminishing-return
    // gain, q2 (first wrong answer for this skill) only lowers confidence.
    expect(skillRadarService.persistSkillScoreResult).toHaveBeenCalledTimes(2);
    expect(skillRadarService.persistSkillScoreResult).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: "user-1",
        skillId: "skill-backend",
        sourceType: "QUIZ_ATTEMPT",
        sourceId: "attempt-1",
        result: expect.objectContaining({ scoreDelta: 10 }),
        reason: expect.stringContaining("BackEnd: correct answer"),
      }),
    );
    expect(skillRadarService.persistSkillScoreResult).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: "user-1",
        skillId: "skill-backend",
        sourceType: "QUIZ_ATTEMPT",
        sourceId: "attempt-1",
        result: expect.objectContaining({ scoreDelta: 0, newWrongStreak: 1 }),
        reason: expect.stringContaining("BackEnd: wrong answer"),
      }),
    );
  });

  it("uses AI skill analysis for quiz attempts when questions have no skill mapping", async () => {
    const { service, prisma, skillRadarService } = makeService();
    skillRadarService.analyzeUserTextSkills.mockResolvedValue({
      usedAiClassifier: true,
      candidates: [
        {
          skillId: "skill-devops",
          skillName: "DevOps",
          confidence: 0.8,
          reason: "Question mentions deployment workflow",
        },
      ],
    });
    prisma.quiz.findUnique.mockResolvedValue({
      id: "quiz-1",
      createdByUserId: "user-1",
      lessonId: "lesson-1",
      questions: [
        {
          id: "q1",
          questionText: "What is the correct deployment workflow?",
          correctIndex: 1,
          explanation: "Use a safe deployment workflow.",
          options: ["a", "b", "c", "d"],
          skillMappings: [],
        },
      ],
    });
    prisma.quizAttempt.create.mockResolvedValue({
      id: "attempt-1",
      submittedAt: new Date("2026-07-06T09:00:00.000Z"),
    });

    await service.submitAttempt(user, "quiz-1", {
      answers: [{ questionId: "q1", selectedIndex: 1 }],
    });

    expect(skillRadarService.analyzeUserTextSkills).toHaveBeenCalledWith(
      "user-1",
      "What is the correct deployment workflow?\nUse a safe deployment workflow.",
      0.2,
    );
    expect(skillRadarService.persistSkillScoreResult).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        skillId: "skill-devops",
        sourceType: "QUIZ_ATTEMPT",
        sourceId: "attempt-1",
        result: expect.objectContaining({ scoreDelta: 8 }),
        reason: expect.stringContaining(
          "DevOps: correct answer (ai-classifier: Question mentions deployment workflow)",
        ),
      }),
    );
  });

  it("creates a new attempt record for every successful submission", async () => {
    const { service, prisma } = makeService();
    prisma.quiz.findUnique.mockResolvedValue({
      id: "quiz-1",
      createdByUserId: "user-1",
      lessonId: "lesson-1",
      questions: [
        {
          id: "q1",
          questionText: "Question 1",
          correctIndex: 0,
          explanation: "exp1",
          options: ["a", "b", "c", "d"],
          skillMappings: [],
        },
      ],
    });
    prisma.quizAttempt.create
      .mockResolvedValueOnce({ id: "attempt-1", submittedAt: new Date("2026-07-06T09:00:00.000Z") })
      .mockResolvedValueOnce({ id: "attempt-2", submittedAt: new Date("2026-07-06T09:05:00.000Z") });

    const answers = { answers: [{ questionId: "q1", selectedIndex: 0 }] };
    const first = await service.submitAttempt(user, "quiz-1", answers);
    const second = await service.submitAttempt(user, "quiz-1", answers);

    expect(first.attemptId).toBe("attempt-1");
    expect(second.attemptId).toBe("attempt-2");
    expect(prisma.quizAttempt.create).toHaveBeenCalledTimes(2);
  });

  it("rejects answers for question ids that do not belong to this quiz", async () => {
    const { service, prisma } = makeService();
    prisma.quiz.findUnique.mockResolvedValue({
      id: "quiz-1",
      createdByUserId: "user-1",
      questions: [{ id: "q1", correctIndex: 1, explanation: "exp1", options: ["a", "b", "c", "d"] }],
    });

    await expect(
      service.submitAttempt(user, "quiz-1", {
        answers: [{ questionId: "q-unknown", selectedIndex: 0 }],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.quizAttempt.create).not.toHaveBeenCalled();
  });

  it("rejects duplicate answers for the same question", async () => {
    const { service, prisma } = makeService();
    prisma.quiz.findUnique.mockResolvedValue({
      id: "quiz-1",
      createdByUserId: "user-1",
      questions: [{ id: "q1", correctIndex: 1, explanation: "exp1", options: ["a", "b", "c", "d"] }],
    });

    await expect(
      service.submitAttempt(user, "quiz-1", {
        answers: [
          { questionId: "q1", selectedIndex: 1 },
          { questionId: "q1", selectedIndex: 2 },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.quizAttempt.create).not.toHaveBeenCalled();
  });

  it("rejects incomplete submissions", async () => {
    const { service, prisma } = makeService();
    prisma.quiz.findUnique.mockResolvedValue({
      id: "quiz-1",
      createdByUserId: "user-1",
      questions: [
        { id: "q1", correctIndex: 1, explanation: "exp1", options: ["a", "b", "c", "d"] },
        { id: "q2", correctIndex: 0, explanation: "exp2", options: ["a", "b", "c", "d"] },
      ],
    });

    await expect(
      service.submitAttempt(user, "quiz-1", {
        answers: [{ questionId: "q1", selectedIndex: 1 }],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.quizAttempt.create).not.toHaveBeenCalled();
  });

  it("rejects selectedIndex values outside the question options", async () => {
    const { service, prisma } = makeService();
    prisma.quiz.findUnique.mockResolvedValue({
      id: "quiz-1",
      createdByUserId: "user-1",
      questions: [{ id: "q1", correctIndex: 1, explanation: "exp1", options: ["a", "b", "c", "d"] }],
    });

    await expect(
      service.submitAttempt(user, "quiz-1", {
        answers: [{ questionId: "q1", selectedIndex: 9 }],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.quizAttempt.create).not.toHaveBeenCalled();
  });
});

describe("QuizService.listAttempts", () => {
  it("returns detailed attempt history only for the current user's quiz attempts", async () => {
    const { service, prisma } = makeService();
    const submittedAt = new Date("2026-07-06T10:00:00.000Z");
    prisma.quiz.findUnique.mockResolvedValue({
      id: "quiz-1",
      title: "Quiz title",
      createdByUserId: "user-1",
    });
    prisma.quizAttempt.findMany.mockResolvedValue([
      {
        id: "attempt-1",
        userId: "user-1",
        quizId: "quiz-1",
        lessonId: "lesson-1",
        score: 50,
        submittedAt,
        selectedAnswers: [
          { questionId: "q1", questionText: "Question 1", selectedIndex: 1, selectedOption: "B" },
        ],
        correctAnswers: [
          {
            questionId: "q1",
            questionText: "Question 1",
            correctIndex: 0,
            correctOption: "A",
            explanation: "exp1",
          },
        ],
        result: {
          score: 50,
          totalQuestions: 1,
          correctCount: 0,
          answers: [
            {
              questionId: "q1",
              selectedIndex: 1,
              correctIndex: 0,
              isCorrect: false,
              explanation: "exp1",
            },
          ],
        },
      },
    ]);

    const result = await service.listAttempts(user, "quiz-1");

    expect(prisma.quizAttempt.findMany).toHaveBeenCalledWith({
      where: { quizId: "quiz-1", userId: "user-1" },
      orderBy: { submittedAt: "desc" },
    });
    expect(result[0]).toMatchObject({
      attemptId: "attempt-1",
      quizTitle: "Quiz title",
      score: 50,
      detailAnswers: [
        {
          questionId: "q1",
          questionText: "Question 1",
          selectedAnswer: "B",
          correctAnswer: "A",
          isCorrect: false,
          explanation: "exp1",
        },
      ],
    });
  });

  it("does not expose attempts from another user's quiz", async () => {
    const { service, prisma } = makeService();
    prisma.quiz.findUnique.mockResolvedValue({
      id: "quiz-1",
      title: "Other user's quiz",
      createdByUserId: "user-2",
    });

    await expect(service.listAttempts(user, "quiz-1")).rejects.toThrow(NotFoundException);
    expect(prisma.quizAttempt.findMany).not.toHaveBeenCalled();
  });

  it("lets an admin inspect all attempts for an accessible quiz", async () => {
    const { service, prisma } = makeService();
    const admin: RequestUser = { id: "admin-1", email: "admin@example.com", role: "ADMIN" };
    prisma.quiz.findUnique.mockResolvedValue({
      id: "quiz-1",
      title: "Shared quiz",
      createdByUserId: "user-2",
    });
    prisma.quizAttempt.findMany.mockResolvedValue([]);

    await service.listAttempts(admin, "quiz-1");

    expect(prisma.quizAttempt.findMany).toHaveBeenCalledWith({
      where: { quizId: "quiz-1" },
      orderBy: { submittedAt: "desc" },
    });
  });
});

describe("QuizService.remove", () => {
  it("throws NotFoundException for a missing quiz", async () => {
    const { service, prisma } = makeService();
    prisma.quiz.findUnique.mockResolvedValue(null);

    await expect(service.remove(user, "missing")).rejects.toThrow(NotFoundException);
    expect(prisma.quiz.delete).not.toHaveBeenCalled();
  });

  it("deletes an existing quiz", async () => {
    const { service, prisma } = makeService();
    prisma.quiz.findUnique.mockResolvedValue({ id: "quiz-1", createdByUserId: "user-1" });
    prisma.quiz.delete.mockResolvedValue({ id: "quiz-1" });

    const result = await service.remove(user, "quiz-1");

    expect(result).toEqual({ success: true });
    expect(prisma.quiz.delete).toHaveBeenCalledWith({ where: { id: "quiz-1" } });
  });
});
