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

  it("falls back safely when AI analysis fails", async () => {
    aiService.chat.mockRejectedValue(new Error("AI unavailable"));

    const result = await service.analyzeQuestion({
      userId: "user-1",
      question: "ช่วยอธิบาย Secure Boot TPM Valorant",
      contextType: "GENERAL_CHAT",
    });

    expect(result.fallbackUsed).toBe(true);
    expect(result.interpretedQuestion).toBe("ช่วยอธิบาย Secure Boot TPM Valorant");
    expect(result.possibleSkills).toEqual([]);
    expect(result.keywords).toEqual(expect.arrayContaining(["secure", "boot", "tpm", "valorant"]));
    expect(result.questionQualityScore).toBe(0.5);
  });
});
