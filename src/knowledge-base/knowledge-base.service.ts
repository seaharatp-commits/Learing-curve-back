import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
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
    summary: string | null;
    keywords: string[];
    tags: string[];
    createdAt: Date;
    updatedAt: Date;
    category: { name: string };
  }) {
    return {
      id: article.id,
      title: article.title,
      content: article.content,
      category: article.category.name,
      summary: article.summary,
      keywords: article.keywords,
      tags: article.tags,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
    };
  }

  private requiredText(value: string, fieldName: string) {
    const normalizedValue = value.trim();
    if (!normalizedValue) throw new BadRequestException(`กรุณาระบุ${fieldName}`);
    return normalizedValue;
  }

  async list() {
    const articles = await this.prisma.knowledgeBaseArticle.findMany({
      orderBy: { updatedAt: "desc" },
      include: { category: true },
    });
    return articles.map((article) => this.toResponse(article));
  }

  async create(authorId: string, dto: KnowledgeBaseDto) {
    const title = this.requiredText(dto.title, "หัวข้อ");
    const categoryName = this.requiredText(dto.category, "หมวดหมู่");
    const content = this.requiredText(dto.content, "เนื้อหา");
    const category = await this.categoriesService.resolveByName(categoryName);
    const article = await this.prisma.knowledgeBaseArticle.create({
      data: {
        title,
        content,
        categoryId: category.id,
        authorId,
        summary: dto.summary?.trim() || null,
        keywords: dto.keywords ?? [],
        tags: dto.tags ?? [],
      },
      include: { category: true },
    });
    return this.toResponse(article);
  }

  async update(id: string, dto: KnowledgeBaseDto) {
    await this.ensureExists(id);
    const title = this.requiredText(dto.title, "หัวข้อ");
    const categoryName = this.requiredText(dto.category, "หมวดหมู่");
    const content = this.requiredText(dto.content, "เนื้อหา");
    const category = await this.categoriesService.resolveByName(categoryName);
    const article = await this.prisma.knowledgeBaseArticle.update({
      where: { id },
      data: {
        title,
        content,
        categoryId: category.id,
        summary: dto.summary?.trim() || null,
        keywords: dto.keywords ?? [],
        tags: dto.tags ?? [],
      },
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
