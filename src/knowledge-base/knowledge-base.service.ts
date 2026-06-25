import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CategoriesService } from "../common/categories.service";
import { KnowledgeBaseDto } from "./dto/knowledge-base.dto";

@Injectable()
export class KnowledgeBaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categoriesService: CategoriesService,
  ) {}

  private toResponse(article: {
    id: string;
    title: string;
    content: string;
    createdAt: Date;
    updatedAt: Date;
    category: { name: string };
  }) {
    return {
      id: article.id,
      title: article.title,
      content: article.content,
      category: article.category.name,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
    };
  }

  async list() {
    const articles = await this.prisma.knowledgeBaseArticle.findMany({
      orderBy: { updatedAt: "desc" },
      include: { category: true },
    });
    return articles.map((article) => this.toResponse(article));
  }

  async create(authorId: string, dto: KnowledgeBaseDto) {
    const category = await this.categoriesService.resolveByName(dto.category);
    const article = await this.prisma.knowledgeBaseArticle.create({
      data: { title: dto.title, content: dto.content, categoryId: category.id, authorId },
      include: { category: true },
    });
    return this.toResponse(article);
  }

  async update(id: string, dto: KnowledgeBaseDto) {
    await this.ensureExists(id);
    const category = await this.categoriesService.resolveByName(dto.category);
    const article = await this.prisma.knowledgeBaseArticle.update({
      where: { id },
      data: { title: dto.title, content: dto.content, categoryId: category.id },
      include: { category: true },
    });
    return this.toResponse(article);
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.knowledgeBaseArticle.delete({ where: { id } });
    return { success: true };
  }

  private async ensureExists(id: string) {
    const article = await this.prisma.knowledgeBaseArticle.findUnique({ where: { id } });
    if (!article) throw new NotFoundException("ไม่พบบทความนี้");
    return article;
  }
}
