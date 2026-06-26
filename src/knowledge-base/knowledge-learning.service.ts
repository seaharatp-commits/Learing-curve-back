import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";
import { CategoriesService } from "../common/categories.service";
import { RecommendationService } from "./recommendation.service";
import type { AiChatMessage } from "../ai/ai.types";
import type { ArticleDraft, ArticleFields } from "./article-draft.types";
import type { ConfirmKnowledgeDto } from "./dto/confirm-knowledge.dto";
import { buildFingerprint, sharedTokens } from "./text-similarity.util";
import type { IssueReport, KnowledgeBaseArticle } from "@prisma/client";

const EXTRACTION_SYSTEM_PROMPT =
  "คุณคือผู้ช่วยเขียนฐานความรู้ (Knowledge Base) เปลี่ยน support ticket ที่แก้ไขแล้วให้เป็นบทความมาตรฐาน " +
  "ห้ามแต่งข้อมูลทางเทคนิคที่ไม่มีอยู่ในรายงานต้นฉบับ ถ้าข้อมูลส่วนใดไม่มีให้ระบุว่า \"ไม่ระบุ\" " +
  "ตอบกลับเป็น JSON เท่านั้น ไม่มีคำอธิบายอื่น ไม่ใช้ markdown หรือ code fence " +
  'รูปแบบ JSON ต้องเป็น: {"title": string, "summary": string, "symptoms": string, "environment": string, ' +
  '"rootCause": string, "resolution": string, "verification": string, "keywords": string[], "tags": string[], "category": string}';

@Injectable()
export class KnowledgeLearningService {
  private readonly logger = new Logger(KnowledgeLearningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly categoriesService: CategoriesService,
    private readonly recommendationService: RecommendationService,
  ) {}

  private buildExtractionMessages(
    issue: IssueReport & { category: { name: string } },
  ): AiChatMessage[] {
    const ticketText = [
      `หัวข้อ: ${issue.title}`,
      `หมวดหมู่: ${issue.category.name}`,
      `ความสำคัญ: ${issue.priority}`,
      `รายละเอียดที่ผู้ใช้รายงาน: ${issue.description}`,
    ].join("\n");

    return [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: ticketText },
    ];
  }

  private buildExtractionMessagesFromText(text: string): AiChatMessage[] {
    return [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: text },
    ];
  }

  private parseDraft(raw: string): ArticleDraft {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`AI did not return JSON: ${raw.slice(0, 200)}`);
    }

    const parsed = JSON.parse(jsonMatch[0]) as Partial<ArticleDraft>;
    const asString = (value: unknown, fallback = "ไม่ระบุ") =>
      typeof value === "string" && value.trim() ? value.trim() : fallback;
    const asStringArray = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

    return {
      title: asString(parsed.title, "ไม่มีหัวข้อ"),
      summary: asString(parsed.summary),
      symptoms: asString(parsed.symptoms),
      environment: asString(parsed.environment),
      rootCause: asString(parsed.rootCause),
      resolution: asString(parsed.resolution),
      verification: asString(parsed.verification),
      keywords: asStringArray(parsed.keywords),
      tags: asStringArray(parsed.tags),
      category: asString(parsed.category, "ทั่วไป"),
    };
  }

  private async extractDraft(
    issue: IssueReport & { category: { name: string } },
  ): Promise<ArticleDraft> {
    const reply = await this.aiService.chat(this.buildExtractionMessages(issue));
    return this.parseDraft(reply);
  }

  private async extractDraftFromText(text: string): Promise<ArticleDraft> {
    const reply = await this.aiService.chat(this.buildExtractionMessagesFromText(text));
    return this.parseDraft(reply);
  }

  private async findSimilarArticle(draft: ArticleDraft): Promise<KnowledgeBaseArticle | null> {
    const draftFingerprint = buildFingerprint([...draft.keywords, draft.title, draft.symptoms]);
    if (draftFingerprint.size === 0) return null;

    const candidates = await this.prisma.knowledgeBaseArticle.findMany({
      include: { category: true },
    });

    let best: { article: KnowledgeBaseArticle; score: number } | null = null;
    for (const article of candidates) {
      const articleFingerprint = buildFingerprint([
        ...article.keywords,
        article.title,
        article.symptoms ?? "",
      ]);
      const shared = sharedTokens(draftFingerprint, articleFingerprint).length;
      const sameCategory = article.category.name === draft.category;
      const meetsThreshold = shared >= 2 || (shared >= 1 && sameCategory);

      if (meetsThreshold && (!best || shared > best.score)) {
        best = { article, score: shared };
      }
    }

    return best?.article ?? null;
  }

  private renderContent(fields: ArticleFields): string {
    const section = (label: string, value: string | null) =>
      value && value !== "ไม่ระบุ" ? `${label}: ${value}` : null;

    return [
      fields.summary && fields.summary !== "ไม่ระบุ" ? fields.summary : null,
      section("อาการที่พบ", fields.symptoms),
      // section("สภาพแวดล้อม", fields.environment),
      section("สาเหตุที่เป็นไปได้", fields.rootCause),
      section("วิธีแก้ไข", fields.resolution),
      section("การตรวจสอบผลลัพธ์", fields.verification),
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n\n");
  }

  private mergeFields(existing: KnowledgeBaseArticle, draft: ArticleDraft): ArticleFields {
    const mergeText = (existingValue: string | null, draftValue: string): string | null => {
      if (!existingValue || existingValue === "ไม่ระบุ") return draftValue;
      if (draftValue === "ไม่ระบุ" || existingValue.includes(draftValue)) return existingValue;
      return `${existingValue}\n(เพิ่มเติม) ${draftValue}`;
    };

    const mergedKeywords = Array.from(
      new Set([...existing.keywords, ...draft.keywords].map((k) => k.trim()).filter(Boolean)),
    );
    const mergedTags = Array.from(
      new Set([...existing.tags, ...draft.tags].map((t) => t.trim()).filter(Boolean)),
    );

    return {
      title: existing.title,
      summary: mergeText(existing.summary, draft.summary),
      symptoms: mergeText(existing.symptoms, draft.symptoms),
      environment: mergeText(existing.environment, draft.environment),
      rootCause: mergeText(existing.rootCause, draft.rootCause),
      resolution: mergeText(existing.resolution, draft.resolution),
      verification: mergeText(existing.verification, draft.verification),
      keywords: mergedKeywords,
      tags: mergedTags,
      category: draft.category,
    };
  }

  async learnFromIssue(issueId: string) {
    const issue = await this.prisma.issueReport.findUnique({
      where: { id: issueId },
      include: { category: true },
    });
    if (!issue) throw new NotFoundException("ไม่พบปัญหานี้");

    const draft = await this.extractDraft(issue);
    const similar = await this.findSimilarArticle(draft);

    let article: KnowledgeBaseArticle;
    let action: "created" | "updated";

    if (similar) {
      const merged = this.mergeFields(similar, draft);
      const category = await this.categoriesService.resolveByName(merged.category);
      article = await this.prisma.knowledgeBaseArticle.update({
        where: { id: similar.id },
        data: {
          summary: merged.summary,
          symptoms: merged.symptoms,
          environment: merged.environment,
          rootCause: merged.rootCause,
          resolution: merged.resolution,
          verification: merged.verification,
          keywords: merged.keywords,
          tags: merged.tags,
          categoryId: category.id,
          content: this.renderContent(merged),
        },
      });
      action = "updated";
      this.logger.log(`Merged issue ${issueId} into existing KB article ${article.id}`);
    } else {
      const category = await this.categoriesService.resolveByName(draft.category);
      const fields: ArticleFields = {
        title: draft.title,
        summary: draft.summary,
        symptoms: draft.symptoms,
        environment: draft.environment,
        rootCause: draft.rootCause,
        resolution: draft.resolution,
        verification: draft.verification,
        keywords: draft.keywords,
        tags: draft.tags,
        category: draft.category,
      };
      article = await this.prisma.knowledgeBaseArticle.create({
        data: {
          title: fields.title,
          content: this.renderContent(fields),
          categoryId: category.id,
          summary: fields.summary,
          symptoms: fields.symptoms,
          environment: fields.environment,
          rootCause: fields.rootCause,
          resolution: fields.resolution,
          verification: fields.verification,
          keywords: fields.keywords,
          tags: fields.tags,
        },
      });
      action = "created";
      this.logger.log(`Created new KB article ${article.id} from issue ${issueId}`);
    }

    await this.prisma.issueReport.update({
      where: { id: issueId },
      data: { status: "RESOLVED", knowledgeBaseArticleId: article.id },
    });

    return { action, article };
  }

  // Step 1 of the "Add Knowledge" flow: turn free-form text into a structured
  // draft for review, plus the existing articles it might duplicate. Nothing
  // is persisted here — the user reviews/edits in the UI and calls
  // confirmKnowledge() to actually save.
  async generateDraft(text: string) {
    const draft = await this.extractDraftFromText(text);
    const similarArticles = await this.recommendationService.recommend({
      title: draft.title,
      description: `${draft.summary} ${draft.symptoms}`,
      category: draft.category,
    });

    return { draft, originalText: text, similarArticles };
  }

  // Step 2: persist the (possibly user-edited) draft. If targetArticleId is
  // set, the user chose to update an existing article instead of creating a
  // duplicate — original text from both contributions is preserved.
  async confirmKnowledge(dto: ConfirmKnowledgeDto, authorId: string) {
    const category = await this.categoriesService.resolveByName(dto.category);
    const fields: ArticleFields = {
      title: dto.title,
      summary: dto.summary,
      symptoms: dto.symptoms,
      environment: dto.environment,
      rootCause: dto.rootCause,
      resolution: dto.resolution,
      verification: dto.verification,
      keywords: dto.keywords,
      tags: dto.tags,
      category: dto.category,
    };
    const content = this.renderContent(fields);

    if (dto.targetArticleId) {
      const existing = await this.prisma.knowledgeBaseArticle.findUnique({
        where: { id: dto.targetArticleId },
      });
      if (!existing) throw new NotFoundException("ไม่พบบทความที่จะอัปเดต");

      const mergedKeywords = Array.from(new Set([...existing.keywords, ...dto.keywords]));
      const mergedTags = Array.from(new Set([...existing.tags, ...dto.tags]));
      const mergedOriginalText = existing.originalText
        ? `${existing.originalText}\n---\n${dto.originalText}`
        : dto.originalText;

      const article = await this.prisma.knowledgeBaseArticle.update({
        where: { id: dto.targetArticleId },
        data: {
          title: dto.title,
          content,
          categoryId: category.id,
          summary: dto.summary,
          symptoms: dto.symptoms,
          environment: dto.environment,
          rootCause: dto.rootCause,
          resolution: dto.resolution,
          verification: dto.verification,
          keywords: mergedKeywords,
          tags: mergedTags,
          originalText: mergedOriginalText,
        },
      });
      this.logger.log(`Updated KB article ${article.id} from contributed knowledge`);
      return { action: "updated" as const, article };
    }

    const article = await this.prisma.knowledgeBaseArticle.create({
      data: {
        title: dto.title,
        content,
        categoryId: category.id,
        authorId,
        summary: dto.summary,
        symptoms: dto.symptoms,
        environment: dto.environment,
        rootCause: dto.rootCause,
        resolution: dto.resolution,
        verification: dto.verification,
        keywords: dto.keywords,
        tags: dto.tags,
        originalText: dto.originalText,
      },
    });
    this.logger.log(`Created KB article ${article.id} from contributed knowledge`);
    return { action: "created" as const, article };
  }
}
