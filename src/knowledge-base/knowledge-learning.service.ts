import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";
import { CategoriesService } from "../common/categories.service";
import type { AiChatMessage } from "../ai/ai.types";
import type { ArticleDraft, ArticleFields } from "./article-draft.types";
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

  // Tokenizes keywords/title/symptoms into individual words so that e.g.
  // "Windows 11" and "Windows" or "0x80070005" and "error 0x80070005"
  // still overlap — AI-generated keyword phrasing varies between calls,
  // so comparing whole keyword strings is too brittle.
  private buildFingerprint(keywords: string[], title: string, symptoms: string): Set<string> {
    const text = [...keywords, title, symptoms].join(" ").toLowerCase();
    const tokens = text.match(/[a-z0-9ก-๙]+/g) ?? [];
    return new Set(tokens.filter((token) => token.length >= 3));
  }

  private async findSimilarArticle(draft: ArticleDraft): Promise<KnowledgeBaseArticle | null> {
    const draftFingerprint = this.buildFingerprint(draft.keywords, draft.title, draft.symptoms);
    if (draftFingerprint.size === 0) return null;

    const candidates = await this.prisma.knowledgeBaseArticle.findMany({
      include: { category: true },
    });

    let best: { article: KnowledgeBaseArticle; score: number } | null = null;
    for (const article of candidates) {
      const articleFingerprint = this.buildFingerprint(
        article.keywords,
        article.title,
        article.symptoms ?? "",
      );
      const shared = [...draftFingerprint].filter((token) => articleFingerprint.has(token)).length;
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
      section("สภาพแวดล้อม", fields.environment),
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
}
