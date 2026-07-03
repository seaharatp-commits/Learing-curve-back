import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";
import { buildFingerprint, jaccardScore, sharedTokens } from "./text-similarity.util";
import type { RecommendQueryDto } from "./dto/recommend-query.dto";
import type { RecommendationResult } from "./recommendation.types";
import type { KnowledgeBaseArticle, Category } from "@prisma/client";

const MIN_CONFIDENCE = 0.1;
const SAME_CATEGORY_BOOST = 0.1;
const MAX_RESULTS = 5;
const PRIMARY_MATCH_BOOST = 0.05;
const EXACT_TITLE_BOOST = 0.12;
const CONTENT_ONLY_PENALTY = 0.08;
const VAGUE_QUERY_PENALTY = 0.06;
const ARTICLE_BATCH_SIZE = 12;

const GENERIC_TOKENS = new Set([
  "the",
  "and",
  "for",
  "with",
  "how",
  "what",
  "why",
  "แก้",
  "แก้ไข",
  "ทำ",
  "ทำยังไง",
  "วิธี",
  "ขั้นตอน",
  "ปัญหา",
  "ระบบ",
  "ข้อมูล",
  "ใช้งาน",
  "ไม่ได้",
  "อยากรู้",
  "ช่วย",
  "บอก",
  "เกี่ยวกับ",
  "ขอ",
  "หน่อย",
  "อธิบาย",
  "คืออะไร",
]);

type ArticleWithCategory = KnowledgeBaseArticle & { category: Category };

interface InterpretedQuery {
  interpretedQuery: string;
  keywords: string[];
}

interface AiCandidate {
  articleId: string;
  confidenceScore: number;
  explanation: string;
}

const INTERPRET_SYSTEM_PROMPT =
  "คุณคือผู้ช่วยตีความคำถามของผู้ใช้งานระบบช่วยเหลือ (Helpdesk) " +
  "หน้าที่ของคุณคือตีความ/เรียบเรียงคำถามให้ชัดเจนและเป็นระบบมากขึ้น โดยต้องคงความหมายเดิมของผู้ใช้ไว้ทั้งหมด " +
  "ห้ามเดาหรือเพิ่มเติมรายละเอียดที่ผู้ใช้ไม่ได้พูดถึง " +
  "ตอบกลับเป็น JSON เท่านั้น ไม่มีคำอธิบายอื่น ไม่ใช้ markdown หรือ code fence " +
  'รูปแบบ JSON ต้องเป็น: {"interpretedQuery": string, "keywords": string[]}';

const SELECT_SYSTEM_PROMPT =
  "คุณคือระบบแนะนำบทความฐานความรู้ (Knowledge Base) ของระบบ Helpdesk " +
  "คุณจะได้รับคำถามที่ตีความแล้วของผู้ใช้ และรายการบทความในฐานความรู้ (JSON array) " +
  "ให้พิจารณาว่าบทความใดน่าจะช่วยตอบคำถามนี้ได้ โดยไม่จำเป็นต้องมีคำตรงกันทุกคำ ให้ใช้ความเข้าใจเชิงความหมายด้วย " +
  "ตอบกลับเป็น JSON array เท่านั้น ไม่มีคำอธิบายอื่น ไม่ใช้ markdown หรือ code fence " +
  "ถ้าไม่มีบทความใดเกี่ยวข้องเลยให้ตอบ [] " +
  'รูปแบบแต่ละรายการ: {"articleId": string, "confidenceScore": number (0-1), "explanation": string (ภาษาไทยสั้นๆ)}';

function withoutGenericTokens(tokens: Set<string>) {
  return new Set([...tokens].filter((token) => !GENERIC_TOKENS.has(token)));
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function toResult(article: ArticleWithCategory, candidate: AiCandidate, query: RecommendQueryDto): RecommendationResult {
  const sameCategory = query.category ? article.category.name === query.category : false;
  return {
    articleId: article.id,
    title: article.title,
    category: article.category.name,
    preview: (article.summary ?? article.resolution ?? article.content ?? "").slice(0, 180),
    summary: article.summary,
    resolution: article.resolution,
    confidenceScore: Math.min(1, Math.max(0, Math.round(candidate.confidenceScore * 100) / 100)),
    matchedKeywords: article.keywords,
    sameCategory,
    explanation: candidate.explanation,
  };
}

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  async recommend(query: RecommendQueryDto): Promise<RecommendationResult[]> {
    const queryFingerprint = withoutGenericTokens(
      buildFingerprint([query.title, query.description ?? ""]),
    );
    if (queryFingerprint.size === 0) return [];

    const articles = (await this.prisma.knowledgeBaseArticle.findMany({
      include: { category: true },
    })) as ArticleWithCategory[];
    if (articles.length === 0) return [];

    try {
      return await this.recommendWithAi(query, articles);
    } catch (error) {
      this.logger.warn(`AI-based recommendation failed, falling back to keyword matching: ${error}`);
      return this.recommendWithKeywordMatching(query, articles, queryFingerprint);
    }
  }

  // Step 1: ask the AI Center to reinterpret the user's question, keeping its meaning intact.
  // Step 2: hand the interpreted question plus batches of knowledge-base articles back to the
  // AI Center and let it judge relevance semantically, instead of relying on literal word overlap.
  private async recommendWithAi(
    query: RecommendQueryDto,
    articles: ArticleWithCategory[],
  ): Promise<RecommendationResult[]> {
    const interpreted = await this.interpretQuery(query);

    const articlesById = new Map(articles.map((article) => [article.id, article]));
    const batches = chunk(articles, ARTICLE_BATCH_SIZE);

    const candidateLists = await Promise.all(
      batches.map((batch) => this.selectFromBatch(query, interpreted, batch)),
    );

    const results: RecommendationResult[] = [];
    for (const candidates of candidateLists) {
      for (const candidate of candidates) {
        const article = articlesById.get(candidate.articleId);
        if (!article) continue;
        results.push(toResult(article, candidate, query));
      }
    }

    return results
      .filter((result) => result.confidenceScore >= MIN_CONFIDENCE)
      .sort((a, b) => b.confidenceScore - a.confidenceScore)
      .slice(0, MAX_RESULTS);
  }

  private async interpretQuery(query: RecommendQueryDto): Promise<InterpretedQuery> {
    const userContent = JSON.stringify({
      title: query.title,
      description: query.description ?? "",
      category: query.category ?? "",
    });

    const reply = await this.aiService.chat([
      { role: "system", content: INTERPRET_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ]);

    const jsonMatch = reply.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`AI did not return JSON for query interpretation: ${reply.slice(0, 200)}`);

    const parsed = JSON.parse(jsonMatch[0]) as Partial<InterpretedQuery>;
    const interpretedQuery =
      typeof parsed.interpretedQuery === "string" && parsed.interpretedQuery.trim()
        ? parsed.interpretedQuery.trim()
        : [query.title, query.description ?? ""].join(" ").trim();
    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.filter((k): k is string => typeof k === "string")
      : [];

    return { interpretedQuery, keywords };
  }

  private async selectFromBatch(
    query: RecommendQueryDto,
    interpreted: InterpretedQuery,
    batch: ArticleWithCategory[],
  ): Promise<AiCandidate[]> {
    const userContent = JSON.stringify({
      interpretedQuery: interpreted.interpretedQuery,
      keywords: interpreted.keywords,
      category: query.category ?? "",
      articles: batch.map((article) => ({
        id: article.id,
        title: article.title,
        summary: article.summary,
        keywords: article.keywords,
        tags: article.tags,
        category: article.category.name,
      })),
    });

    const reply = await this.aiService.chat([
      { role: "system", content: SELECT_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ]);

    const jsonMatch = reply.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error(`AI did not return a JSON array for article selection: ${reply.slice(0, 200)}`);

    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item): item is AiCandidate =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as AiCandidate).articleId === "string" &&
          typeof (item as AiCandidate).confidenceScore === "number",
      )
      .map((item) => ({
        articleId: item.articleId,
        confidenceScore: item.confidenceScore,
        explanation: typeof item.explanation === "string" ? item.explanation : "",
      }));
  }

  // Deterministic keyword/token-overlap fallback, used only if the AI Center is
  // unreachable or returns something unparseable, so recommend() never hard-fails.
  private recommendWithKeywordMatching(
    query: RecommendQueryDto,
    articles: ArticleWithCategory[],
    queryFingerprint: Set<string>,
  ): RecommendationResult[] {
    const normalizedQuery = [query.title, query.description ?? ""].join(" ").toLowerCase();

    const results: RecommendationResult[] = articles.map((article) => {
      const keywords = Array.isArray(article.keywords) ? article.keywords : [];
      const tags = Array.isArray(article.tags) ? article.tags : [];
      const primaryParts = [...keywords, ...tags, article.title, article.summary ?? ""];
      const contentParts = [
        article.content,
        article.symptoms ?? "",
        article.rootCause ?? "",
        article.resolution ?? "",
      ];

      const titleFingerprint = buildFingerprint([article.title]);
      const keywordFingerprint = buildFingerprint(keywords);
      const tagFingerprint = buildFingerprint(tags);
      const summaryFingerprint = buildFingerprint([article.summary ?? ""]);
      const contentFingerprint = buildFingerprint(contentParts);
      const primaryFingerprint = buildFingerprint(primaryParts);

      const coverage = (target: Set<string>) =>
        target.size === 0 ? 0 : sharedTokens(queryFingerprint, target).length / queryFingerprint.size;

      const primaryMatches = sharedTokens(queryFingerprint, primaryFingerprint);
      const sameCategory = query.category ? article.category.name === query.category : false;

      const titleScore = coverage(titleFingerprint);
      const keywordScore = coverage(keywordFingerprint);
      const tagScore = coverage(tagFingerprint);
      const summaryScore = coverage(summaryFingerprint);
      const contentScore = coverage(contentFingerprint);
      const primaryScore = jaccardScore(queryFingerprint, primaryFingerprint);
      const matchedPrimaryFields = [titleScore > 0, keywordScore > 0, tagScore > 0, summaryScore > 0].filter(
        Boolean,
      ).length;
      const fieldDiversityBoost = Math.min(0.06, Math.max(0, matchedPrimaryFields - 1) * 0.02);
      const titleText = article.title.toLowerCase();
      const exactTitleBoost =
        titleText.length >= 3 && (normalizedQuery.includes(titleText) || titleText.includes(normalizedQuery))
          ? EXACT_TITLE_BOOST
          : 0;
      const contentOnlyPenalty = primaryMatches.length === 0 && contentScore > 0 ? CONTENT_ONLY_PENALTY : 0;
      const vagueQueryPenalty = queryFingerprint.size <= 1 ? VAGUE_QUERY_PENALTY : 0;

      const confidenceScore = Math.min(
        1,
        Math.max(
          0,
          titleScore * 0.35 +
            keywordScore * 0.25 +
            tagScore * 0.15 +
            summaryScore * 0.15 +
            contentScore * 0.05 +
            primaryScore * 0.05 +
            fieldDiversityBoost +
            exactTitleBoost +
            (primaryMatches.length > 0 ? PRIMARY_MATCH_BOOST : 0) +
            (sameCategory ? SAME_CATEGORY_BOOST : 0) -
            contentOnlyPenalty -
            vagueQueryPenalty,
        ),
      );

      return {
        articleId: article.id,
        title: article.title,
        category: article.category.name,
        preview: (article.summary ?? article.resolution ?? article.content ?? "").slice(0, 180),
        summary: article.summary,
        resolution: article.resolution,
        confidenceScore: Math.round(confidenceScore * 100) / 100,
        matchedKeywords: sharedTokens(queryFingerprint, buildFingerprint([...primaryParts, ...contentParts])),
        sameCategory,
        explanation: "จับคู่ด้วยคำสำคัญ (สำรองกรณี AI Center ใช้งานไม่ได้)",
      };
    });

    return results
      .filter((result) => result.confidenceScore >= MIN_CONFIDENCE)
      .sort((a, b) => b.confidenceScore - a.confidenceScore)
      .slice(0, MAX_RESULTS);
  }
}
