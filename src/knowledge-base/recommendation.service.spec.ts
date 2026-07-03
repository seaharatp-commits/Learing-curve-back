import { RecommendationService } from "./recommendation.service";
import { PrismaService } from "../prisma/prisma.service";
import { AiService } from "../ai/ai.service";

type MockArticle = {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  resolution: string | null;
  symptoms: string | null;
  rootCause: string | null;
  keywords: string[];
  tags: string[];
  category: { name: string };
};

function makeArticle(overrides: Partial<MockArticle>): MockArticle {
  return {
    id: "id-1",
    title: "",
    content: "",
    summary: null,
    resolution: null,
    symptoms: null,
    rootCause: null,
    keywords: [],
    tags: [],
    category: { name: "ทั่วไป" },
    ...overrides,
  };
}

describe("RecommendationService", () => {
  let prisma: { knowledgeBaseArticle: { findMany: jest.Mock } };
  let aiService: { chat: jest.Mock };
  let service: RecommendationService;

  beforeEach(() => {
    prisma = { knowledgeBaseArticle: { findMany: jest.fn() } };
    // These tests exercise the deterministic keyword-matching fallback, which is
    // what recommend() uses whenever the AI Center is unavailable or unparseable.
    aiService = { chat: jest.fn().mockRejectedValue(new Error("AI Center unavailable in tests")) };
    service = new RecommendationService(
      prisma as unknown as PrismaService,
      aiService as unknown as AiService,
    );
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
        title: "Module Alpha",
        keywords: ["module", "alpha"],
        category: { name: "หมวด A" },
      }),
    ]);

    const [result] = await service.recommend({ title: "module alpha", category: "หมวด A" });
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

  it("prefers title keywords and tags over a weak content-only match", async () => {
    prisma.knowledgeBaseArticle.findMany.mockResolvedValue([
      makeArticle({
        id: "kb-content-only",
        title: "วิธีตั้งค่าทั่วไป",
        content: "เอกสารนี้กล่าวถึง workflow แบบกว้าง ๆ แต่ไม่ได้เกี่ยวกับ merge workflow โดยตรง",
      }),
      makeArticle({
        id: "kb-primary",
        title: "Merge workflow method A",
        keywords: ["merge", "workflow"],
        tags: ["method-a"],
        summary: "ขั้นตอนสำหรับ merge workflow method A",
      }),
    ]);

    const result = await service.recommend({ title: "ขั้นตอน merge workflow method A" });

    expect(result).toHaveLength(1);
    expect(result[0].articleId).toBe("kb-primary");
    expect(result[0].confidenceScore).toBeGreaterThanOrEqual(0.1);
  });

  it("does not show weak matches that only come from long content", async () => {
    prisma.knowledgeBaseArticle.findMany.mockResolvedValue([
      makeArticle({
        id: "kb-weak",
        title: "ตั้งค่าระบบทั่วไป",
        content:
          "บทความยาวที่กล่าวถึงคำทั่วไปจำนวนมาก เช่น workflow และขั้นตอน แต่ไม่มีชื่อเรื่องหรือ keyword ที่ตรงกับคำถามเฉพาะ",
      }),
    ]);

    const result = await service.recommend({ title: "merge workflow platform x" });

    expect(result).toEqual([]);
  });

  it("ignores generic Thai filler words when there are no specific terms", async () => {
    prisma.knowledgeBaseArticle.findMany.mockResolvedValue([
      makeArticle({
        id: "kb-generic",
        title: "ข้อมูลการใช้งานระบบทั่วไป",
        keywords: ["ข้อมูล", "ระบบ", "ใช้งาน"],
      }),
    ]);

    const result = await service.recommend({ title: "ช่วย บอก เกี่ยวกับ ระบบ หน่อย" });

    expect(result).toEqual([]);
    expect(prisma.knowledgeBaseArticle.findMany).not.toHaveBeenCalled();
  });
});
