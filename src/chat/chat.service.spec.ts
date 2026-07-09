import { ChatService } from "./chat.service";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";
import { AiQuestionUnderstandingService } from "../ai/ai-question-understanding.service";
import { RecommendationService } from "../knowledge-base/recommendation.service";
import { SkillRadarService } from "../skill-radar/skill-radar.service";

function makeService() {
  const prisma = {
    chatMessage: {
      findMany: jest.fn().mockImplementation(({ where }: { where: { role: string } }) => {
        if (where.role === "USER") return Promise.resolve([{ content: "next.js ควรทำยังไงดี" }]);
        return Promise.resolve([{ sourceArticleTitle: "คู่มือ Next.js เบื้องต้น" }]);
      }),
    },
    lesson: {
      findMany: jest.fn().mockResolvedValue([{ title: "React Basics" }]),
      count: jest.fn().mockResolvedValue(4),
    },
    lessonProgress: {
      count: jest.fn().mockResolvedValue(2),
    },
    quizAttempt: {
      findMany: jest.fn().mockResolvedValue([{ quiz: { title: "Frontend Quiz" } }]),
    },
  };
  const aiService = { chat: jest.fn() };
  const aiQuestionUnderstandingService = { analyzeQuestion: jest.fn() };
  const recommendationService = { recommend: jest.fn(), searchCandidates: jest.fn(), rerankCandidates: jest.fn() };
  const skillRadarService = {
    getUserRadar: jest.fn().mockResolvedValue({
      position: { id: "position-1", name: "Software Engineer", description: null, isActive: true },
      skills: [
        { id: "skill-frontend", name: "FrontEnd", description: null, score: 70, evidenceCount: 3 },
        { id: "skill-backend", name: "BackEnd", description: null, score: 20, evidenceCount: 2 },
        { id: "skill-devops", name: "DevOps", description: null, score: 0, evidenceCount: 0 },
      ],
    }),
    recordQuestionInterestSignal: jest.fn().mockResolvedValue([]),
  };

  const service = new ChatService(
    prisma as unknown as PrismaService,
    aiService as unknown as AiService,
    aiQuestionUnderstandingService as unknown as AiQuestionUnderstandingService,
    recommendationService as unknown as RecommendationService,
    skillRadarService as unknown as SkillRadarService,
  );

  return { service, prisma, aiService, skillRadarService };
}

describe("ChatService.getSuggestedQuestions", () => {
  it("builds a behavior summary and returns AI-generated questions, capped at 3", async () => {
    const { service, aiService, skillRadarService } = makeService();
    aiService.chat.mockResolvedValue(
      JSON.stringify([
        "Next.js ควรจัดโครงสร้าง component ยังไงให้ดูแลง่าย?",
        "ถ้า API โหลดช้า ควรตรวจจาก frontend หรือ backend ก่อน?",
        "ทำไม state เปลี่ยนแล้ว UI ไม่ update?",
        "ควรเทส component ด้วยอะไรดี?",
      ]),
    );

    const result = await service.getSuggestedQuestions("user-1");

    expect(result.questions).toHaveLength(3);
    expect(skillRadarService.getUserRadar).toHaveBeenCalledWith("user-1");

    const [, userMessage] = aiService.chat.mock.calls[0][0];
    const summary = JSON.parse(userMessage.content);
    expect(summary.currentPosition).toBe("Software Engineer");
    expect(summary.topSkills).toEqual(["FrontEnd", "BackEnd"]);
    expect(summary.recentQuestions).toEqual(["next.js ควรทำยังไงดี"]);
    expect(summary.recentTopics).toEqual(expect.arrayContaining(["React Basics", "Frontend Quiz"]));
    expect(summary.positionSkills).toEqual(["FrontEnd", "BackEnd", "DevOps"]);
    expect(summary.latestActivities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "chat_question" }),
        expect.objectContaining({ type: "lesson_created", title: "React Basics" }),
        expect.objectContaining({ type: "quiz_attempt", title: "Frontend Quiz" }),
      ]),
    );
    expect(summary.latestActivities.length).toBeLessThanOrEqual(10);
    expect(summary.learningProgress).toEqual({ completedLessons: 2, totalLessons: 4, percentage: 50 });
    expect(summary.recommendedKnowledgeBase).toEqual(["คู่มือ Next.js เบื้องต้น"]);
  });

  it("falls back to activity-based questions when the AI Center is unavailable", async () => {
    const { service, aiService } = makeService();
    aiService.chat.mockRejectedValue(new Error("AI down"));

    const result = await service.getSuggestedQuestions("user-1");

    expect(result.questions).toHaveLength(3);
    expect(result.questions.every((question) => question.length > 0)).toBe(true);
  });

  it("falls back to activity-based questions when the AI returns too few usable questions", async () => {
    const { service, aiService } = makeService();
    aiService.chat.mockResolvedValue(JSON.stringify(["Only one question?"]));

    const result = await service.getSuggestedQuestions("user-1");

    expect(result.questions).toHaveLength(3);
    expect(result.questions.every((question) => question.length > 0)).toBe(true);
  });

  it("reuses cached suggested questions when the activity snapshot is unchanged", async () => {
    const { service, aiService } = makeService();
    aiService.chat.mockResolvedValue(
      JSON.stringify([
        "ควรต่อยอด Next.js เรื่อง performance อย่างไร?",
        "ถ้าจะทำเว็บขายของควรจัด component ยังไง?",
        "ควรทบทวน FrontEnd Quiz เรื่องไหนก่อน?",
      ]),
    );

    const first = await service.getSuggestedQuestions("user-1");
    const second = await service.getSuggestedQuestions("user-1");

    expect(second.questions).toEqual(first.questions);
    expect(aiService.chat).toHaveBeenCalledTimes(1);
  });
});
