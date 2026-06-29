import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { LearningDashboard, LessonCompletion, LessonDetail } from "./learning-dashboard.types";

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

    const totalCompleted = new Set(attempts.map((attempt) => attempt.quizId)).size;
    const averageScore =
      attempts.length === 0
        ? 0
        : Math.round(attempts.reduce((sum, attempt) => sum + attempt.score, 0) / attempts.length);
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

  async getLesson(userId: string, lessonId: string): Promise<LessonDetail> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        progress: { where: { userId } },
        quizzes: {
          orderBy: { createdAt: "desc" },
          include: { _count: { select: { questions: true } } },
        },
      },
    });
    if (!lesson) throw new NotFoundException("ไม่พบบทเรียนนี้");

    const progress = lesson.progress[0];
    return {
      id: lesson.id,
      title: lesson.title,
      content: lesson.content,
      completed: progress?.completed ?? false,
      completedAt: progress?.completedAt ?? null,
      quizzes: lesson.quizzes.map((quiz) => ({
        id: quiz.id,
        title: quiz.title,
        questionCount: quiz._count.questions,
      })),
    };
  }

  async markLessonCompleted(userId: string, lessonId: string): Promise<LessonCompletion> {
    const lesson = await this.prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) throw new NotFoundException("ไม่พบบทเรียนนี้");

    const progress = await this.prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      update: { completed: true, completedAt: new Date() },
      create: { userId, lessonId, completed: true, completedAt: new Date() },
    });

    return {
      lessonId,
      completed: progress.completed,
      completedAt: progress.completedAt,
    };
  }
}
