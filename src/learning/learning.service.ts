import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SkillRadarService } from "../skill-radar/skill-radar.service";
import type { LearningDashboard, LessonCompletion, LessonDetail } from "./learning-dashboard.types";
import type { RequestUser } from "../auth/strategies/jwt.strategy";

const RECENT_QUIZ_LIMIT = 5;

@Injectable()
export class LearningService {
  private readonly logger = new Logger(LearningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly skillRadarService: SkillRadarService,
  ) {}

  async getDashboard(user: RequestUser): Promise<LearningDashboard> {
    const userId = user.id;
    const lessonScope = user.role === "ADMIN" ? {} : { createdByUserId: userId };
    const quizScope = user.role === "ADMIN" ? {} : { quiz: { createdByUserId: userId } };
    const [totalLessons, completedLessons, attempts, lessons] = await Promise.all([
      this.prisma.lesson.count({ where: lessonScope }),
      this.prisma.lessonProgress.count({ where: { userId, completed: true, lesson: lessonScope } }),
      this.prisma.quizAttempt.findMany({
        where: { userId, ...quizScope },
        orderBy: { completedAt: "desc" },
        include: { quiz: true },
      }),
      this.prisma.lesson.findMany({
        where: lessonScope,
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
    const lessonItems = lessons.map((lesson) => ({
      lessonId: lesson.id,
      title: lesson.title,
      completed: lesson.progress.some((p) => p.completed),
    }));

    return {
      learningProgress: { completedLessons, totalLessons, percentage },
      quizPerformance: { totalCompleted, averageScore, latestScore },
      recentQuizzes,
      continueLearning,
      lessons: lessonItems,
    };
  }

  async getLesson(user: RequestUser, lessonId: string): Promise<LessonDetail> {
    const userId = user.id;
    const quizScope = user.role === "ADMIN" ? undefined : { createdByUserId: userId };
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: {
        progress: { where: { userId } },
        quizzes: {
          where: quizScope,
          orderBy: { createdAt: "desc" },
          include: { _count: { select: { questions: true } } },
        },
      },
    });
    if (!lesson) throw new NotFoundException("ไม่พบบทเรียนนี้");
    if (user.role !== "ADMIN" && lesson.createdByUserId !== userId) {
      throw new NotFoundException("ไม่พบบทเรียนนี้");
    }

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

  async markLessonCompleted(user: RequestUser, lessonId: string): Promise<LessonCompletion> {
    const userId = user.id;
    const lesson = await this.prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!lesson) throw new NotFoundException("ไม่พบบทเรียนนี้");
    if (user.role !== "ADMIN" && lesson.createdByUserId !== userId) {
      throw new NotFoundException("ไม่พบบทเรียนนี้");
    }

    const existingProgress = await this.prisma.lessonProgress.findUnique({
      where: { userId_lessonId: { userId, lessonId } },
    });
    const isFirstCompletion = !existingProgress?.completed;

    const progress = await this.prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      update: { completed: true, completedAt: new Date() },
      create: { userId, lessonId, completed: true, completedAt: new Date() },
    });

    if (isFirstCompletion) {
      this.skillRadarService
        .recordLessonCompletionSkillSignals({
          userId,
          lessonId,
          lessonTitle: lesson.title,
          lessonContent: lesson.content,
        })
        .catch((error) => {
          this.logger.warn(`Failed to record lesson completion skill signal: ${error}`);
        });
    }

    return {
      lessonId,
      completed: progress.completed,
      completedAt: progress.completedAt,
    };
  }
}
