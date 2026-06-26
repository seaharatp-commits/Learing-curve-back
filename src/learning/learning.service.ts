import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { LearningDashboard } from "./learning-dashboard.types";

const RECENT_QUIZ_LIMIT = 5;

@Injectable()
export class LearningService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(userId: string): Promise<LearningDashboard> {
    const [totalLessons, completedLessons, attempts, lessons] = await Promise.all([
      this.prisma.lesson.count(),
      this.prisma.lessonProgress.count({ where: { userId, completed: true } }),
      this.prisma.quizAttempt.findMany({
        where: { userId },
        orderBy: { completedAt: "desc" },
        include: { quiz: true },
      }),
      this.prisma.lesson.findMany({
        orderBy: { order: "asc" },
        include: { progress: { where: { userId } } },
      }),
    ]);

    const percentage = totalLessons === 0 ? 0 : Math.round((completedLessons / totalLessons) * 100);

    const totalCompleted = attempts.length;
    const averageScore =
      totalCompleted === 0
        ? 0
        : Math.round(attempts.reduce((sum, attempt) => sum + attempt.score, 0) / totalCompleted);
    const latestScore = attempts[0]?.score ?? null;

    const recentQuizzes = attempts.slice(0, RECENT_QUIZ_LIMIT).map((attempt) => ({
      id: attempt.id,
      title: attempt.quiz.title,
      score: attempt.score,
      completedAt: attempt.completedAt,
    }));

    const nextLesson = lessons.find((lesson) => !lesson.progress.some((p) => p.completed));
    const continueLearning = nextLesson ? { lessonId: nextLesson.id, title: nextLesson.title } : null;

    return {
      learningProgress: { completedLessons, totalLessons, percentage },
      quizPerformance: { totalCompleted, averageScore, latestScore },
      recentQuizzes,
      continueLearning,
    };
  }
}
