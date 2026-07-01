export interface RecommendationResult {
  articleId: string;
  title: string;
  category: string;
  preview: string;
  summary: string | null;
  resolution: string | null;
  confidenceScore: number;
  matchedKeywords: string[];
  sameCategory: boolean;
  explanation: string;
}
