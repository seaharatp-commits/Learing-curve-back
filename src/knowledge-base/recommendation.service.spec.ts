import { RecommendationService } from "./recommendation.service";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";

type MockArticle = {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  resolution: string | null;
  symptoms: string | null;
  rootCause: string | null;
  keywords: string[];
  tags: string[];
  category: { name: string };
};

function makeArticle(overrides: Partial<MockArticle>): MockArticle {
  return {
    id: "id-1",
    title: "",
    content: "",
    summary: null,
    resolution: null,
    symptoms: null,
    rootCause: null,
    keywords: [],
    tags: [],
    category: { name: "ทั่วไป" },
    ...overrides,
  };
}

describe("RecommendationService", () => {
  let prisma: { knowledgeBaseArticle: { findMany: jest.Mock } };
  let aiService: { chat: jest.Mock };
  let service: RecommendationService;

  beforeEach(() => {
    prisma = { knowledgeBaseArticle: { findMany: jest.fn() } };
    aiService = { chat: jest.fn() };
    service = new RecommendationService(
      prisma as unknown as PrismaService,
      aiService as unknown as AiService,
    );
  });

  describe("recommend", () => {
    it("returns nothing when the query has no usable tokens, without calling the AI Center", async () => {
      const result = await service.recommend({ title: "a", description: "" });
      expect(result).toEqual([]);
      expect(prisma.knowledgeBaseArticle.findMany).not.toHaveBeenCalled();
      expect(aiService.chat).not.toHaveBeenCalled();
    });

    it("returns nothing when there are no articles to consider", async () => {
      prisma.knowledgeBaseArticle.findMany.mockResolvedValue([]);
      const result = await service.recommend({ title: "merge workflow" });
      expect(result).toEqual([]);
      expect(aiService.chat).not.toHaveBeenCalled();
    });

    it("throws an AI ล่ม error instead of falling back to keyword matching when the AI Center fails", async () => {
      prisma.knowledgeBaseArticle.findMany.mockResolvedValue([
        makeArticle({ id: "kb-1", title: "Windows error", keywords: ["windows"] }),
      ]);
      aiService.chat.mockRejectedValue(new Error("AI Center unavailable"));

      await expect(service.recommend({ title: "merge workflow" })).rejects.toThrow(/AI ล่ม/);
    });

    it("returns AI-selected recommendations when the AI Center succeeds", async () => {
      prisma.knowledgeBaseArticle.findMany.mockResolvedValue([
        makeArticle({
          id: "kb-primary",
          title: "Merge workflow method A",
          keywords: ["merge", "workflow"],
          tags: ["method-a"],
          summary: "ขั้นตอนสำหรับ merge workflow method A",
        }),
      ]);
      aiService.chat
        .mockResolvedValueOnce(
          JSON.stringify({ interpretedQuery: "How to merge workflow method A", keywords: ["merge", "workflow"] }),
        )
        .mockResolvedValueOnce(
          JSON.stringify([{ articleId: "kb-primary", confidenceScore: 0.8, explanation: "ตรงกับคำถาม" }]),
        );

      const result = await service.recommend({ title: "ขั้นตอน merge workflow method A" });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ articleId: "kb-primary", confidenceScore: 0.8 });
    });
  });

  describe("searchCandidates", () => {
    it("searches and normalizes Knowledge Base candidates from multiple signals", async () => {
      prisma.knowledgeBaseArticle.findMany.mockResolvedValue([
        makeArticle({
          id: "kb-next-ui",
          title: "เลือก UI library สำหรับ Next.js",
          summary: "เปรียบเทียบ Ant Design และ MUI สำหรับเว็บขายของ",
          content: "แนวทางเลือก component library สำหรับ ecommerce",
          keywords: ["Next.js", "Ant Design", "MUI"],
          tags: ["frontend", "ui"],
        }),
      ]);

      const result = await service.searchCandidates({
        originalQuestion: "next.js ใช้ ant design หรือ mui ดี",
        interpretedQuestion: "Compare Ant Design and MUI for Next.js ecommerce",
        keywords: ["Next.js", "Ant Design", "MUI"],
        possibleSkills: [{ skillName: "FrontEnd", confidence: 0.8 }],
        limit: 5,
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "kb-next-ui",
        title: "เลือก UI library สำหรับ Next.js",
        tags: expect.arrayContaining(["Next.js", "Ant Design", "MUI", "frontend", "ui"]),
      });
      expect(result[0].databaseRelevanceScore).toBeGreaterThan(0);
      expect(result[0].contentPreview?.length).toBeLessThanOrEqual(500);
    });
  });

  describe("rerankCandidates", () => {
    it("reranks candidates with AI and filters unknown ids", async () => {
      aiService.chat.mockResolvedValue(
        JSON.stringify({
          recommendations: [
            {
              knowledgeBaseId: "kb-1",
              confidenceScore: 0.87,
              matchedSkills: ["FrontEnd"],
              reason: "ตรงกับ Next.js และ UI library",
              whyThisKBIsRelevant: "ช่วยตอบคำถามเรื่องการเลือก Ant Design หรือ MUI",
              shouldRecommend: true,
            },
            {
              knowledgeBaseId: "unknown-id",
              confidenceScore: 0.99,
              matchedSkills: ["FrontEnd"],
              reason: "AI invented this id",
              whyThisKBIsRelevant: "invalid",
              shouldRecommend: true,
            },
          ],
        }),
      );

      const result = await service.rerankCandidates({
        analysis: {
          originalQuestion: "next.js ใช้ ant design หรือ mui ดี",
          interpretedQuestion: "Compare Ant Design and MUI for Next.js ecommerce",
          intent: "compare_ui_library",
          possibleSkills: [{ skillName: "FrontEnd", confidence: 0.8 }],
          keywords: ["Next.js", "Ant Design", "MUI"],
          difficultyGuess: "intermediate",
          questionQualityScore: 0.8,
        },
        candidates: [
          {
            id: "kb-1",
            title: "เลือก UI library สำหรับ Next.js",
            summary: "เปรียบเทียบ Ant Design และ MUI",
            tags: ["Next.js", "MUI"],
            relatedSkills: ["FrontEnd"],
            contentPreview: "preview",
            databaseRelevanceScore: 0.4,
          },
        ],
      });

      expect(result).toEqual([
        {
          knowledgeBaseId: "kb-1",
          confidenceScore: 0.87,
          matchedSkills: ["FrontEnd"],
          reason: "ตรงกับ Next.js และ UI library",
          whyThisKBIsRelevant: "ช่วยตอบคำถามเรื่องการเลือก Ant Design หรือ MUI",
          shouldRecommend: true,
        },
      ]);
    });

    it("throws an AI ล่ม error instead of falling back to a database score when AI reranking fails", async () => {
      aiService.chat.mockRejectedValue(new Error("AI down"));

      await expect(
        service.rerankCandidates({
          analysis: {
            originalQuestion: "merge workflow",
            interpretedQuestion: "merge workflow",
            intent: "learn_workflow",
            possibleSkills: [],
            keywords: ["merge", "workflow"],
            difficultyGuess: "unknown",
            questionQualityScore: 0.5,
          },
          candidates: [
            {
              id: "kb-high",
              title: "High score",
              tags: ["merge"],
              relatedSkills: ["DevOps"],
              databaseRelevanceScore: 0.42,
            },
          ],
        }),
      ).rejects.toThrow(/AI ล่ม/);
    });
  });
});
