import { AiQuestionUnderstandingService } from "./ai-question-understanding.service";
import type { AiService } from "./ai.service";

describe("AiQuestionUnderstandingService", () => {
  let aiService: { chat: jest.Mock };
  let service: AiQuestionUnderstandingService;

  beforeEach(() => {
    aiService = { chat: jest.fn() };
    service = new AiQuestionUnderstandingService(aiService as unknown as AiService);
  });

  it("normalizes strict JSON returned by the AI", async () => {
    aiService.chat.mockResolvedValue(
      JSON.stringify({
        originalQuestion: "next.js ใช้ ant design หรือ mui ดี",
        interpretedQuestion: "Compare Ant Design and MUI for a Next.js ecommerce website",
        intent: "compare_ui_library",
        possibleSkills: [{ skillName: "FrontEnd", confidence: 0.82 }],
        keywords: ["Next.js", "Ant Design", "MUI", "ecommerce"],
        difficultyGuess: "intermediate",
        questionQualityScore: 0.78,
      }),
    );

    const result = await service.analyzeQuestion({
      userId: "user-1",
      question: "next.js ใช้ ant design หรือ mui ดี",
      contextType: "GENERAL_CHAT",
    });

    expect(result.fallbackUsed).toBe(false);
    expect(result.interpretedQuestion).toContain("Compare");
    expect(result.possibleSkills).toEqual([{ skillName: "FrontEnd", confidence: 0.82 }]);
    expect(result.keywords).toContain("Next.js");
  });

  it("throws an AI-down error instead of falling back to keyword extraction when AI analysis fails", async () => {
    aiService.chat.mockRejectedValue(new Error("AI unavailable"));

    await expect(
      service.analyzeQuestion({
        userId: "user-1",
        question: "ช่วยอธิบาย Secure Boot TPM Valorant",
        contextType: "GENERAL_CHAT",
      }),
    ).rejects.toThrow(/AI ล่ม/);
  });

  it("returns an empty analysis without calling the AI for a blank question", async () => {
    const result = await service.analyzeQuestion({
      userId: "user-1",
      question: "   ",
      contextType: "GENERAL_CHAT",
    });

    expect(aiService.chat).not.toHaveBeenCalled();
    expect(result.intent).toBe("empty_question");
    expect(result.possibleSkills).toEqual([]);
    expect(result.keywords).toEqual([]);
  });
});
