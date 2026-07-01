import { BadRequestException, NotFoundException } from "@nestjs/common";
import { QuizService } from "./quiz.service";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";
import type { RequestUser } from "../auth/strategies/jwt.strategy";

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
    quizAttempt: { create: jest.fn() },
  };
  const aiService = { chat: jest.fn() };
  const service = new QuizService(
    prisma as unknown as PrismaService,
    aiService as unknown as AiService,
  );
  return { service, prisma, aiService };
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
      title: "ทดสอบ",
      content: "เนื้อหาทดสอบครั้งที่ 1",
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
    const { service, prisma, aiService } = makeService();
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
});

describe("QuizService.askLessonQuestion", () => {
  it("answers a learner question using the lesson and chat history", async () => {
    const { service, prisma, aiService } = makeService();
    prisma.lesson.findUnique.mockResolvedValue({
      id: "lesson-1",
      title: "Lesson 1",
      content: "Lesson content",
      createdByUserId: "user-1",
    });
    aiService.chat.mockResolvedValue("Answer from lesson");

    const result = await service.askLessonQuestion(user, "lesson-1", "What next?", "ผู้เรียน: hi");

    expect(result).toEqual({ answer: "Answer from lesson" });
    expect(aiService.chat).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining("What next?") }),
      ]),
      { temperature: 0.5, maxTokens: 1000 },
    );
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

    expect(result).toEqual({
      answer: "## สรุปแบบเข้าใจง่าย\n\nเนื้อหาคำตอบที่ผู้เรียนควรเห็นค่ะ",
    });
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
        title: "แบบทดสอบ: Lesson 1",
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
    const { service, prisma } = makeService();
    prisma.quiz.findUnique.mockResolvedValue({
      id: "quiz-1",
      createdByUserId: "user-1",
      questions: [
        { id: "q1", correctIndex: 1, explanation: "exp1", options: ["a", "b", "c", "d"] },
        { id: "q2", correctIndex: 0, explanation: "exp2", options: ["a", "b", "c", "d"] },
      ],
    });
    prisma.quizAttempt.create.mockResolvedValue({ id: "attempt-1" });

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
    expect(prisma.quizAttempt.create).toHaveBeenCalledWith({
      data: { userId: "user-1", quizId: "quiz-1", score: 50 },
    });
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
