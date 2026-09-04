import { BadRequestException } from "@nestjs/common";
import { CategoriesService } from "../common/categories.service";
import { PrismaService } from "../prisma/prisma.service";
import { KnowledgeBaseService } from "./knowledge-base.service";

function makeService() {
  const prisma = {
    knowledgeBaseArticle: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  const categoriesService = {
    resolveByName: jest.fn().mockResolvedValue({ id: "category-1", name: "Docker" }),
  };
  const service = new KnowledgeBaseService(
    prisma as unknown as PrismaService,
    categoriesService as unknown as CategoriesService,
  );
  return { service, prisma, categoriesService };
}

describe("KnowledgeBaseService input validation", () => {
  it("trims required fields before creating an article", async () => {
    const { service, prisma, categoriesService } = makeService();
    prisma.knowledgeBaseArticle.create.mockResolvedValue({
      id: "kb-1",
      title: "Docker basics",
      content: "Run a container",
      summary: null,
      keywords: [],
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      category: { name: "Docker" },
    });

    await service.create("admin-1", {
      title: "  Docker basics  ",
      category: "  Docker  ",
      content: "  Run a container  ",
      summary: "  Short summary  ",
    });

    expect(categoriesService.resolveByName).toHaveBeenCalledWith("Docker");
    expect(prisma.knowledgeBaseArticle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          authorId: "admin-1",
          title: "Docker basics",
          content: "Run a container",
          summary: "Short summary",
        }),
      }),
    );
  });

  it("rejects whitespace-only required fields before touching the database", async () => {
    const { service, prisma, categoriesService } = makeService();

    await expect(
      service.create("admin-1", { title: "   ", category: "Docker", content: "Run a container" }),
    ).rejects.toThrow(BadRequestException);

    expect(categoriesService.resolveByName).not.toHaveBeenCalled();
    expect(prisma.knowledgeBaseArticle.create).not.toHaveBeenCalled();
  });
});
