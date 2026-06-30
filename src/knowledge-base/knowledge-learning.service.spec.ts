import { NotFoundException } from "@nestjs/common";
import { KnowledgeLearningService } from "./knowledge-learning.service";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";
import { CategoriesService } from "../common/categories.service";
import { RecommendationService } from "./recommendation.service";

const DRAFT_JSON = {
  title: "เปิดแอปไม่ได้",
  summary: "สรุป",
  symptoms: "แอปไม่เปิด",
  environment: "Windows 11",
  rootCause: "ไม่ระบุ",
  resolution: "รัน Administrator",
  verification: "ไม่ระบุ",
  keywords: ["windows", "error"],
  tags: ["installation"],
  category: "ปัญหาการติดตั้ง",
};

function makeService() {
  const prisma = {
    knowledgeBaseArticle: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  };
  const aiService = { chat: jest.fn().mockResolvedValue(JSON.stringify(DRAFT_JSON)) };
  const categoriesService = {
    resolveByName: jest.fn().mockResolvedValue({ id: "cat-1", name: "ปัญหาการติดตั้ง" }),
  };
  const recommendationService = { recommend: jest.fn().mockResolvedValue([]) };

  const service = new KnowledgeLearningService(
    prisma as unknown as PrismaService,
    aiService as unknown as AiService,
    categoriesService as unknown as CategoriesService,
    recommendationService as unknown as RecommendationService,
  );

  return { service, prisma, aiService, categoriesService, recommendationService };
}

describe("KnowledgeLearningService.confirmKnowledge", () => {
  it("creates a new article with the given author when no target is set", async () => {
    const { service, prisma } = makeService();
    prisma.knowledgeBaseArticle.create.mockResolvedValue({ id: "kb-new" });

    const result = await service.confirmKnowledge(
      { ...DRAFT_JSON, originalText: "original text" },
      "user-1",
    );

    expect(result.action).toBe("created");
    expect(prisma.knowledgeBaseArticle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ authorId: "user-1", originalText: "original text" }),
      }),
    );
  });

  it("throws NotFoundException when targetArticleId does not exist", async () => {
    const { service, prisma } = makeService();
    prisma.knowledgeBaseArticle.findUnique.mockResolvedValue(null);

    await expect(
      service.confirmKnowledge(
        { ...DRAFT_JSON, originalText: "x", targetArticleId: "missing" },
        "user-1",
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it("unions keywords/tags and appends original text when updating a target article", async () => {
    const { service, prisma } = makeService();
    prisma.knowledgeBaseArticle.findUnique.mockResolvedValue({
      id: "kb-existing",
      keywords: ["existing"],
      tags: ["existing-tag"],
      originalText: "first contribution",
    });
    prisma.knowledgeBaseArticle.update.mockResolvedValue({ id: "kb-existing" });

    await service.confirmKnowledge(
      { ...DRAFT_JSON, originalText: "second contribution", targetArticleId: "kb-existing" },
      "user-1",
    );

    const updateData = prisma.knowledgeBaseArticle.update.mock.calls[0][0].data;
    expect(updateData.keywords).toEqual(expect.arrayContaining(["existing", "windows", "error"]));
    expect(updateData.originalText).toBe("first contribution\n---\nsecond contribution");
  });
});
