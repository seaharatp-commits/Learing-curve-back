import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";
import { buildFingerprint, jaccardScore, sharedTokens } from "./text-similarity.util";
import type { RecommendQueryDto } from "./dto/recommend-query.dto";
import type { RecommendationResult } from "./recommendation.types";
import type { KnowledgeBaseArticle, Category } from "@prisma/client";
import type {
  KnowledgeBaseCandidate,
  KnowledgeBaseRecommendation,
  QuestionAnalysisResult,
} from "../ai/ai-question-understanding.types";

const MIN_CONFIDENCE = 0.1;
const MAX_RESULTS = 5;
const ARTICLE_BATCH_SIZE = 12;
const CANDIDATE_PREVIEW_LENGTH = 500;
const CANDIDATE_MIN_DATABASE_SCORE = 0.03;
const RERANK_MIN_CONFIDENCE = 0.1;
const RERANK_MAX_RESULTS = 5;
const RERANK_OPTIONS = { temperature: 0.1, maxTokens: 700 };

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

interface SearchCandidatesInput {
  originalQuestion: string;
  interpretedQuestion: string;
  keywords: string[];
  possibleSkills: Array<{ skillName: string; confidence: number }>;
  limit?: number;
}

interface RerankCandidatesInput {
  analysis: QuestionAnalysisResult;
  candidates: KnowledgeBaseCandidate[];
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

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

const RERANK_SYSTEM_PROMPT = [
  "You are selecting the most relevant Knowledge Base items for a learner question.",
  "Do not answer the learner. Only rank Knowledge Base candidates.",
  "Return strict JSON only. Do not use Markdown or code fences.",
  "Return shape:",
  "{",
  '  "recommendations": [',
  "    {",
  '      "knowledgeBaseId": string,',
  '      "confidenceScore": number,',
  '      "matchedSkills": string[],',
  '      "reason": string,',
  '      "whyThisKBIsRelevant": string,',
  '      "shouldRecommend": boolean',
  "    }",
  "  ]",
  "}",
  "Rules:",
  "- Only use knowledgeBaseId values from the candidates list.",
  "- Do not invent IDs.",
  "- confidenceScore must be between 0 and 1.",
  "- shouldRecommend should be true only when confidenceScore >= 0.5.",
  "- Prefer semantic relevance over exact keyword match.",
  "- Return at most 5 recommendations.",
].join("\n");

function clamp01(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function uniqueStrings(values: string[], maxItems = 20): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleanValue = value.trim();
    const key = cleanValue.toLowerCase();
    if (!cleanValue || seen.has(key)) continue;
    seen.add(key);
    result.push(cleanValue);
    if (result.length >= maxItems) break;
  }
  return result;
}

function limitText(value: string | null | undefined, maxLength: number): string | null {
  const cleanValue = (value ?? "").replace(/\s+/g, " ").trim();
  if (!cleanValue) return null;
  if (cleanValue.length <= maxLength) return cleanValue;
  return `${cleanValue.slice(0, maxLength).trim()}...`;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`AI did not return JSON object: ${cleaned.slice(0, 160)}`);
  return JSON.parse(match[0]) as Record<string, unknown>;
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

  async searchCandidates(input: SearchCandidatesInput): Promise<KnowledgeBaseCandidate[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 30));
    const queryFingerprint = buildFingerprint([
      input.originalQuestion,
      input.interpretedQuestion,
      ...input.keywords,
      ...input.possibleSkills.map((skill) => skill.skillName),
    ]);

    if (queryFingerprint.size === 0) return [];

    const searchTerms = uniqueStrings(
      [...input.keywords, ...input.possibleSkills.map((skill) => skill.skillName), ...queryFingerprint].filter(
        (term) => term.trim().length >= 2,
      ),
      12,
    );

    const where: Prisma.KnowledgeBaseArticleWhereInput | undefined = searchTerms.length
      ? {
          OR: searchTerms.flatMap((term): Prisma.KnowledgeBaseArticleWhereInput[] => [
            { title: { contains: term, mode: "insensitive" } },
            { summary: { contains: term, mode: "insensitive" } },
            { content: { contains: term, mode: "insensitive" } },
            { resolution: { contains: term, mode: "insensitive" } },
            { keywords: { has: term } },
            { tags: { has: term } },
          ]),
        }
      : undefined;

    const articles = (await this.prisma.knowledgeBaseArticle.findMany({
      where,
      include: { category: true },
      orderBy: { updatedAt: "desc" },
      take: Math.max(limit * 3, limit),
    })) as ArticleWithCategory[];

    return articles
      .map((article) => this.toKnowledgeBaseCandidate(article, input, queryFingerprint))
      .filter((candidate) => (candidate.databaseRelevanceScore ?? 0) >= CANDIDATE_MIN_DATABASE_SCORE)
      .sort((a, b) => (b.databaseRelevanceScore ?? 0) - (a.databaseRelevanceScore ?? 0))
      .slice(0, limit);
  }

  async rerankCandidates(input: RerankCandidatesInput): Promise<KnowledgeBaseRecommendation[]> {
    if (input.candidates.length === 0) return [];

    try {
      const reply = await this.aiService.chat(
        [
          { role: "system", content: RERANK_SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              questionAnalysis: input.analysis,
              candidates: input.candidates.map((candidate) => ({
                id: candidate.id,
                title: candidate.title,
                summary: candidate.summary,
                tags: candidate.tags,
                relatedSkills: candidate.relatedSkills,
                difficulty: candidate.difficulty,
                contentPreview: candidate.contentPreview,
                databaseRelevanceScore: candidate.databaseRelevanceScore,
              })),
            }),
          },
        ],
        RERANK_OPTIONS,
      );

      return this.normalizeRerankReply(reply, input.candidates);
    } catch (error) {
      this.logger.warn(`AI ล่ม: KB reranking unavailable: ${error}`);
      throw new Error(`AI ล่ม: KB reranking unavailable (${error})`);
    }
  }

  private toKnowledgeBaseCandidate(
    article: ArticleWithCategory,
    input: SearchCandidatesInput,
    queryFingerprint: Set<string>,
  ): KnowledgeBaseCandidate {
    const keywords = Array.isArray(article.keywords) ? article.keywords : [];
    const tags = Array.isArray(article.tags) ? article.tags : [];
    const primaryParts = [article.title, article.summary ?? "", ...keywords, ...tags, article.category.name];
    const contentParts = [article.content, article.symptoms ?? "", article.rootCause ?? "", article.resolution ?? ""];
    const allArticleFingerprint = buildFingerprint([...primaryParts, ...contentParts]);
    const primaryFingerprint = buildFingerprint(primaryParts);
    const contentFingerprint = buildFingerprint(contentParts);
    const titleFingerprint = buildFingerprint([article.title]);
    const keywordFingerprint = buildFingerprint(keywords);
    const tagFingerprint = buildFingerprint(tags);
    const summaryFingerprint = buildFingerprint([article.summary ?? ""]);
    const skillMatches = input.possibleSkills.filter((skill) => {
      const skillFingerprint = buildFingerprint([skill.skillName]);
      return sharedTokens(skillFingerprint, allArticleFingerprint).length > 0;
    });

    const coverage = (target: Set<string>) =>
      target.size === 0 ? 0 : sharedTokens(queryFingerprint, target).length / queryFingerprint.size;

    const score =
      coverage(titleFingerprint) * 0.32 +
      coverage(keywordFingerprint) * 0.24 +
      coverage(tagFingerprint) * 0.18 +
      coverage(summaryFingerprint) * 0.14 +
      jaccardScore(queryFingerprint, primaryFingerprint) * 0.08 +
      coverage(contentFingerprint) * 0.04 +
      Math.min(0.12, skillMatches.reduce((sum, skill) => sum + skill.confidence, 0) * 0.04);

    return {
      id: article.id,
      title: article.title,
      summary: article.summary,
      tags: uniqueStrings([...tags, ...keywords, article.category.name], 12),
      relatedSkills: uniqueStrings(skillMatches.map((skill) => skill.skillName), 8),
      difficulty: null,
      contentPreview: limitText(article.summary ?? article.resolution ?? article.content, CANDIDATE_PREVIEW_LENGTH),
      databaseRelevanceScore: Math.round(Math.min(1, Math.max(0, score)) * 100) / 100,
    };
  }

  private normalizeRerankReply(
    rawReply: string,
    candidates: KnowledgeBaseCandidate[],
  ): KnowledgeBaseRecommendation[] {
    const candidateIds = new Set(candidates.map((candidate) => candidate.id));
    const parsed = parseJsonObject(rawReply);
    const recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];

    return recommendations
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as { knowledgeBaseId?: unknown }).knowledgeBaseId === "string" &&
          candidateIds.has((item as { knowledgeBaseId: string }).knowledgeBaseId),
      )
      .map((item): KnowledgeBaseRecommendation => {
        const confidenceScore = clamp01(item.confidenceScore);
        return {
          knowledgeBaseId: item.knowledgeBaseId as string,
          confidenceScore: Math.round(confidenceScore * 100) / 100,
          matchedSkills: uniqueStrings(
            Array.isArray(item.matchedSkills)
              ? item.matchedSkills.filter((skill): skill is string => typeof skill === "string")
              : [],
            8,
          ),
          reason: typeof item.reason === "string" ? item.reason.trim() : "",
          whyThisKBIsRelevant:
            typeof item.whyThisKBIsRelevant === "string" ? item.whyThisKBIsRelevant.trim() : "",
          shouldRecommend: item.shouldRecommend === true && confidenceScore >= 0.5,
        };
      })
      .filter((recommendation) => recommendation.confidenceScore >= RERANK_MIN_CONFIDENCE)
      .sort((a, b) => b.confidenceScore - a.confidenceScore)
      .slice(0, RERANK_MAX_RESULTS);
  }

  async recommend(query: RecommendQueryDto): Promise<RecommendationResult[]> {
    const queryFingerprint = buildFingerprint([query.title, query.description ?? ""]);
    if (queryFingerprint.size === 0) return [];

    const articles = (await this.prisma.knowledgeBaseArticle.findMany({
      include: { category: true },
    })) as ArticleWithCategory[];
    if (articles.length === 0) return [];

    try {
      return await this.recommendWithAi(query, articles);
    } catch (error) {
      this.logger.warn(`AI ล่ม: AI-based recommendation unavailable: ${error}`);
      throw new Error(`AI ล่ม: AI-based recommendation unavailable (${error})`);
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

}
