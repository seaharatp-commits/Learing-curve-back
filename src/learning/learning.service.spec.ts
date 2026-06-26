import { LearningService } from "./learning.service";
import { PrismaService } from "../prisma/prisma.service";

function makeService() {
  const prisma = {
    lesson: { count: jest.fn(), findMany: jest.fn() },
    lessonProgress: { count: jest.fn() },
    quizAttempt: { findMany: jest.fn() },
  };
  const service = new LearningService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe("LearningService.getDashboard", () => {
  it("returns zeroed-out stats when the user has no lessons or attempts", async () => {
    const { service, prisma } = makeService();
    prisma.lesson.count.mockResolvedValue(0);
    prisma.lessonProgress.count.mockResolvedValue(0);
    prisma.quizAttempt.findMany.mockResolvedValue([]);
    prisma.lesson.findMany.mockResolvedValue([]);

    const result = await service.getDashboard("user-1");

    expect(result.learningProgress).toEqual({
      completedLessons: 0,
      totalLessons: 0,
      percentage: 0,
    });
    expect(result.quizPerformance).toEqual({
      totalCompleted: 0,
      averageScore: 0,
      latestScore: null,
    });
    expect(result.recentQuizzes).toEqual([]);
    expect(result.continueLearning).toBeNull();
  });

  it("computes percentage, average/latest score, and picks the first incomplete lesson", async () => {
    const { service, prisma } = makeService();
    prisma.lesson.count.mockResolvedValue(4);
    prisma.lessonProgress.count.mockResolvedValue(1);
    prisma.quizAttempt.findMany.mockResolvedValue([
      { id: "a2", score: 90, completedAt: new Date("2026-01-02"), quiz: { title: "Quiz 2" } },
      { id: "a1", score: 70, completedAt: new Date("2026-01-01"), quiz: { title: "Quiz 1" } },
    ]);
    prisma.lesson.findMany.mockResolvedValue([
      { id: "l1", title: "Lesson 1", progress: [{ completed: true }] },
      { id: "l2", title: "Lesson 2", progress: [] },
      { id: "l3", title: "Lesson 3", progress: [{ completed: false }] },
    ]);

    const result = await service.getDashboard("user-1");

    expect(result.learningProgress).toEqual({
      completedLessons: 1,
      totalLessons: 4,
      percentage: 25,
    });
    // latest = first item (already ordered desc by completedAt), average = (90+70)/2
    expect(result.quizPerformance).toEqual({
      totalCompleted: 2,
      averageScore: 80,
      latestScore: 90,
    });
    expect(result.recentQuizzes).toEqual([
      { id: "a2", title: "Quiz 2", score: 90, completedAt: new Date("2026-01-02") },
      { id: "a1", title: "Quiz 1", score: 70, completedAt: new Date("2026-01-01") },
    ]);
    // l1 is completed, l2 has no progress row at all -> first incomplete
    expect(result.continueLearning).toEqual({ lessonId: "l2", title: "Lesson 2" });
  });

  it("returns null continueLearning when every lesson is completed", async () => {
    const { service, prisma } = makeService();
    prisma.lesson.count.mockResolvedValue(1);
    prisma.lessonProgress.count.mockResolvedValue(1);
    prisma.quizAttempt.findMany.mockResolvedValue([]);
    prisma.lesson.findMany.mockResolvedValue([
      { id: "l1", title: "Lesson 1", progress: [{ completed: true }] },
    ]);

    const result = await service.getDashboard("user-1");
    expect(result.continueLearning).toBeNull();
  });
});
