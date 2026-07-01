import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { buildFingerprint, jaccardScore, sharedTokens } from "./text-similarity.util";
import type { RecommendQueryDto } from "./dto/recommend-query.dto";
import type { RecommendationResult } from "./recommendation.types";

const MIN_CONFIDENCE = 0.05;
const SAME_CATEGORY_BOOST = 0.1;
const MAX_RESULTS = 5;

@Injectable()
export class RecommendationService {
  constructor(private readonly prisma: PrismaService) {}

  async recommend(query: RecommendQueryDto): Promise<RecommendationResult[]> {
    const queryFingerprint = buildFingerprint([query.title, query.description ?? ""]);
    if (queryFingerprint.size === 0) return [];

    const articles = await this.prisma.knowledgeBaseArticle.findMany({
      include: { category: true },
    });

    const results: RecommendationResult[] = articles.map((article) => {
      const articleFingerprint = buildFingerprint([
        ...article.keywords,
        article.title,
        article.content,
        article.summary ?? "",
        article.symptoms ?? "",
        article.rootCause ?? "",
        article.resolution ?? "",
      ]);
      const matchedKeywords = sharedTokens(queryFingerprint, articleFingerprint);
      const sameCategory = query.category ? article.category.name === query.category : false;
      const baseScore = jaccardScore(queryFingerprint, articleFingerprint);
      const confidenceScore = Math.min(1, baseScore + (sameCategory ? SAME_CATEGORY_BOOST : 0));

      const explanationParts = [
        matchedKeywords.length > 0
          ? `พบคำสำคัญที่ตรงกัน ${matchedKeywords.length} คำ (${matchedKeywords.slice(0, 6).join(", ")})`
          : "ไม่พบคำสำคัญที่ตรงกันโดยตรง",
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
