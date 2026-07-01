import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { buildFingerprint, jaccardScore, sharedTokens } from "./text-similarity.util";
import type { RecommendQueryDto } from "./dto/recommend-query.dto";
import type { RecommendationResult } from "./recommendation.types";

const MIN_CONFIDENCE = 0.1;
const SAME_CATEGORY_BOOST = 0.1;
const MAX_RESULTS = 5;
const PRIMARY_MATCH_BOOST = 0.05;
const EXACT_TITLE_BOOST = 0.12;
const CONTENT_ONLY_PENALTY = 0.08;
const VAGUE_QUERY_PENALTY = 0.06;

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

function withoutGenericTokens(tokens: Set<string>) {
  return new Set([...tokens].filter((token) => !GENERIC_TOKENS.has(token)));
}

function coverageScore(queryTokens: Set<string>, targetTokens: Set<string>) {
  if (queryTokens.size === 0 || targetTokens.size === 0) return 0;
  return sharedTokens(queryTokens, targetTokens).length / queryTokens.size;
}

function uniqueTokens(tokens: string[]) {
  return [...new Set(tokens)];
}

@Injectable()
export class RecommendationService {
  constructor(private readonly prisma: PrismaService) {}

  async recommend(query: RecommendQueryDto): Promise<RecommendationResult[]> {
    const queryFingerprint = buildFingerprint([query.title, query.description ?? ""]);
    if (queryFingerprint.size === 0) return [];
    const importantQueryFingerprint = withoutGenericTokens(queryFingerprint);
    if (importantQueryFingerprint.size === 0) return [];
    const scoreQueryFingerprint = importantQueryFingerprint;
    const normalizedQuery = [query.title, query.description ?? ""].join(" ").toLowerCase();

    const articles = await this.prisma.knowledgeBaseArticle.findMany({
      include: { category: true },
    });

    const results: RecommendationResult[] = articles.map((article) => {
      const keywords = Array.isArray(article.keywords) ? article.keywords : [];
      const tags = Array.isArray(article.tags) ? article.tags : [];
      const titleFingerprint = buildFingerprint([article.title]);
      const keywordFingerprint = buildFingerprint(keywords);
      const tagFingerprint = buildFingerprint(tags);
      const summaryFingerprint = buildFingerprint([article.summary ?? ""]);
      const contentFingerprint = buildFingerprint([
        article.content,
        article.symptoms ?? "",
        article.rootCause ?? "",
        article.resolution ?? "",
      ]);
      const primaryFingerprint = buildFingerprint([
        ...keywords,
        ...tags,
        article.title,
        article.summary ?? "",
      ]);
      const articleFingerprint = buildFingerprint([
        ...keywords,
        ...tags,
        article.title,
        article.content,
        article.summary ?? "",
        article.symptoms ?? "",
        article.rootCause ?? "",
        article.resolution ?? "",
      ]);
      const matchedKeywords = sharedTokens(queryFingerprint, articleFingerprint);
      const primaryMatches = sharedTokens(queryFingerprint, primaryFingerprint);
      const importantMatches = uniqueTokens([
        ...sharedTokens(scoreQueryFingerprint, titleFingerprint),
        ...sharedTokens(scoreQueryFingerprint, keywordFingerprint),
        ...sharedTokens(scoreQueryFingerprint, tagFingerprint),
        ...sharedTokens(scoreQueryFingerprint, summaryFingerprint),
      ]);
      const sameCategory = query.category ? article.category.name === query.category : false;
      const titleScore = coverageScore(scoreQueryFingerprint, titleFingerprint);
      const keywordScore = coverageScore(scoreQueryFingerprint, keywordFingerprint);
      const tagScore = coverageScore(scoreQueryFingerprint, tagFingerprint);
      const summaryScore = coverageScore(scoreQueryFingerprint, summaryFingerprint);
      const contentScore = coverageScore(scoreQueryFingerprint, contentFingerprint);
      const primaryScore = jaccardScore(scoreQueryFingerprint, primaryFingerprint);
      const matchedPrimaryFields = [
        titleScore > 0,
        keywordScore > 0,
        tagScore > 0,
        summaryScore > 0,
      ].filter(Boolean).length;
      const fieldDiversityBoost = Math.min(0.06, Math.max(0, matchedPrimaryFields - 1) * 0.02);
      const titleText = article.title.toLowerCase();
      const exactTitleBoost =
        titleText.length >= 3 && (normalizedQuery.includes(titleText) || titleText.includes(normalizedQuery))
          ? EXACT_TITLE_BOOST
          : 0;
      const contentOnlyPenalty =
        primaryMatches.length === 0 && contentScore > 0 ? CONTENT_ONLY_PENALTY : 0;
      const vagueQueryPenalty = scoreQueryFingerprint.size <= 1 ? VAGUE_QUERY_PENALTY : 0;
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

      const explanationParts = [
        importantMatches.length > 0
          ? `พบคำสำคัญหลักที่ตรงกัน ${importantMatches.length} คำ (${importantMatches.slice(0, 6).join(", ")})`
          : matchedKeywords.length > 0
            ? `พบคำที่ตรงกันในเนื้อหา ${matchedKeywords.length} คำ (${matchedKeywords.slice(0, 6).join(", ")})`
            : "ไม่พบคำสำคัญที่ตรงกันโดยตรง",
        titleScore > 0 ? "ตรงกับชื่อเรื่อง" : null,
        keywordScore > 0 || tagScore > 0 ? "ตรงกับ keywords/tags" : null,
        contentOnlyPenalty > 0 ? "คะแนนลดลงเพราะพบคำตรงกันเฉพาะในเนื้อหายาว" : null,
        vagueQueryPenalty > 0 ? "คะแนนลดลงเพราะคำถามยังค่อนข้างกว้าง" : null,
        sameCategory ? "อยู่ในหมวดหมู่เดียวกัน" : null,
      ].filter((part): part is string => Boolean(part));

      return {
        articleId: article.id,
        title: article.title,
        category: article.category.name,
        preview: (article.summary ?? article.resolution ?? article.content ?? "").slice(0, 180),
        summary: article.summary,
        resolution: article.resolution,
        confidenceScore: Math.round(confidenceScore * 100) / 100,
        matchedKeywords,
        sameCategory,
        explanation: explanationParts.join(" และ"),
      };
    });

    return results
      .filter((result) => result.confidenceScore >= MIN_CONFIDENCE)
      .sort((a, b) => b.confidenceScore - a.confidenceScore)
      .slice(0, MAX_RESULTS);
  }
}
