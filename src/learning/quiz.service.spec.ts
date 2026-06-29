import { BadRequestException, NotFoundException } from "@nestjs/common";
import { QuizService } from "./quiz.service";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";

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

function makeService() {
  const prisma = {
    knowledgeBaseArticle: { findUnique: jest.fn() },
    quiz: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
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

    await expect(service.generateFromArticle("missing")).rejects.toThrow(NotFoundException);
  });

  it("creates a quiz with parsed questions from a valid AI response", async () => {
    const { service, prisma, aiService } = makeService();
    prisma.knowledgeBaseArticle.findUnique.mockResolvedValue({
      id: "kb-1",
      title: "วิธีรีเซ็ตรหัสผ่าน",
      content: "...",
    });
    aiService.chat.mockResolvedValue(VALID_QUESTIONS_JSON);
    prisma.quiz.create.mockResolvedValue({ id: "quiz-1", questions: [{}, {}] });

    const result = await service.generateFromArticle("kb-1");

    expect(result.id).toBe("quiz-1");
    const createArgs = prisma.quiz.create.mock.calls[0][0];
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
    prisma.knowledgeBaseArticle.findUnique.mockResolvedValue({ id: "kb-1", title: "x", content: "y" });
    aiService.chat.mockResolvedValue(JSON.stringify({ questions: [{ question: "no options" }] }));

    await expect(service.generateFromArticle("kb-1")).rejects.toThrow(BadRequestException);
    expect(prisma.quiz.create).not.toHaveBeenCalled();
  });

  it("recovers from a trailing comma (real failure seen from the AI gateway)", async () => {
    const { service, prisma, aiService } = makeService();
    prisma.knowledgeBaseArticle.findUnique.mockResolvedValue({ id: "kb-1", title: "x", content: "y" });
    // Strips the closing brace's trailing comma that breaks JSON.parse.
    const withTrailingComma = VALID_QUESTIONS_JSON.replace(/\]\}$/, "],}");
    aiService.chat.mockResolvedValue(withTrailingComma);
    prisma.quiz.create.mockResolvedValue({ id: "quiz-1", questions: [{}, {}] });

    const result = await service.generateFromArticle("kb-1");
    expect(result.id).toBe("quiz-1");
  });

  it("throws BadRequestException when the AI response is unrecoverably broken", async () => {
    const { service, prisma, aiService } = makeService();
    prisma.knowledgeBaseArticle.findUnique.mockResolvedValue({ id: "kb-1", title: "x", content: "y" });
    aiService.chat.mockResolvedValue('{"questions": [{"question": "unterminated string]}');

    await expect(service.generateFromArticle("kb-1")).rejects.toThrow(BadRequestException);
    expect(prisma.quiz.create).not.toHaveBeenCalled();
  });
});

describe("QuizService.submitAttempt", () => {
  it("throws NotFoundException for a missing quiz", async () => {
    const { service, prisma } = makeService();
    prisma.quiz.findUnique.mockResolvedValue(null);

    await expect(service.submitAttempt("user-1", "missing", { answers: [] })).rejects.toThrow(
      NotFoundException,
    );
  });

  it("scores answers correctly and ignores answers for unknown question ids", async () => {
    const { service, prisma } = makeService();
    prisma.quiz.findUnique.mockResolvedValue({
      id: "quiz-1",
      questions: [
        { id: "q1", correctIndex: 1, explanation: "exp1" },
        { id: "q2", correctIndex: 0, explanation: "exp2" },
      ],
    });
    prisma.quizAttempt.create.mockResolvedValue({ id: "attempt-1" });

    const result = await service.submitAttempt("user-1", "quiz-1", {
      answers: [
        { questionId: "q1", selectedIndex: 1 }, // correct
        { questionId: "q2", selectedIndex: 2 }, // wrong
        { questionId: "q-unknown", selectedIndex: 0 }, // ignored
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
});
