import { RecommendationService } from "./recommendation.service";
import { PrismaService } from "../prisma/prisma.service";

type MockArticle = {
  id: string;
  title: string;
  summary: string | null;
  resolution: string | null;
  symptoms: string | null;
  rootCause: string | null;
  keywords: string[];
  category: { name: string };
};

function makeArticle(overrides: Partial<MockArticle>): MockArticle {
  return {
    id: "id-1",
    title: "",
    summary: null,
    resolution: null,
    symptoms: null,
    rootCause: null,
    keywords: [],
    category: { name: "ทั่วไป" },
    ...overrides,
  };
}

describe("RecommendationService", () => {
  let prisma: { knowledgeBaseArticle: { findMany: jest.Mock } };
  let service: RecommendationService;

  beforeEach(() => {
    prisma = { knowledgeBaseArticle: { findMany: jest.fn() } };
    service = new RecommendationService(prisma as unknown as PrismaService);
  });

  it("returns nothing when the query has no usable tokens", async () => {
    const result = await service.recommend({ title: "a", description: "" });
    expect(result).toEqual([]);
    expect(prisma.knowledgeBaseArticle.findMany).not.toHaveBeenCalled();
  });

  it("returns nothing when there is no token overlap with any article", async () => {
    prisma.knowledgeBaseArticle.findMany.mockResolvedValue([
      makeArticle({ id: "kb-1", title: "เครื่องพิมพ์มีรอยขาว", keywords: ["printer"] }),
    ]);

    const result = await service.recommend({ title: "ลืมรหัสผ่าน เข้าระบบไม่ได้" });
    expect(result).toEqual([]);
  });

  it("ranks higher-overlap articles above lower-overlap ones", async () => {
    prisma.knowledgeBaseArticle.findMany.mockResolvedValue([
      makeArticle({
        id: "kb-low",
        title: "Windows error",
        keywords: ["windows"],
        category: { name: "ปัญหาการติดตั้ง" },
      }),
      makeArticle({
        id: "kb-high",
        title: "Windows 11 error 0x80070005",
        keywords: ["windows", "0x80070005", "error"],
        category: { name: "ปัญหาการติดตั้ง" },
      }),
    ]);

    const result = await service.recommend({
      title: "เปิดโปรแกรมไม่ได้ บน Windows ขึ้น error 0x80070005",
    });

    expect(result.map((r) => r.articleId)).toEqual(["kb-high", "kb-low"]);
    expect(result[0].confidenceScore).toBeGreaterThan(result[1].confidenceScore);
  });

  it("boosts confidence and flags sameCategory when categories match", async () => {
    // Partial overlap (not a perfect 1.0 match) so the category boost is
    // actually observable instead of being clipped by the score's 1.0 cap.
    prisma.knowledgeBaseArticle.findMany.mockResolvedValue([
      makeArticle({
        id: "kb-1",
        title: "เปิดแอปไม่ได้ Windows",
        keywords: ["เปิดแอปไม่ได้", "windows", "error"],
        category: { name: "ปัญหาการติดตั้ง" },
      }),
    ]);

    const [withMatch] = await service.recommend({
      title: "เปิดแอปไม่ได้",
      category: "ปัญหาการติดตั้ง",
    });
    const [withoutMatch] = await service.recommend({
      title: "เปิดแอปไม่ได้",
      category: "อื่นๆ",
    });

    expect(withMatch.sameCategory).toBe(true);
    expect(withoutMatch.sameCategory).toBe(false);
    expect(withMatch.confidenceScore).toBeGreaterThan(withoutMatch.confidenceScore);
  });

  it("never returns a confidence score above 1", async () => {
    prisma.knowledgeBaseArticle.findMany.mockResolvedValue([
      makeArticle({
        id: "kb-1",
        title: "ปัญหา A",
        keywords: ["ปัญหา"],
        category: { name: "หมวด A" },
      }),
    ]);

    const [result] = await service.recommend({ title: "ปัญหา A", category: "หมวด A" });
    expect(result.confidenceScore).toBeLessThanOrEqual(1);
  });

  it("caps results at 5 and sorts descending by confidence", async () => {
    const articles = Array.from({ length: 8 }, (_, i) =>
      makeArticle({
        id: `kb-${i}`,
        title: `เครื่องพิมพ์ ${"a".repeat(i + 1)}`,
        keywords: ["เครื่องพิมพ์", "a".repeat(i + 1)],
      }),
    );
    prisma.knowledgeBaseArticle.findMany.mockResolvedValue(articles);

    const result = await service.recommend({ title: "เครื่องพิมพ์ aaaaaaaa" });

    expect(result.length).toBeLessThanOrEqual(5);
    const scores = result.map((r) => r.confidenceScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});
