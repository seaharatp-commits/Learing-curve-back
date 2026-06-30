import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const [userCount, totalChats, knowledgeBaseCount, quizCount, quizAttemptCount, completedLessonCount] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.chatSession.count(),
      this.prisma.knowledgeBaseArticle.count(),
      this.prisma.quiz.count({ where: { questions: { some: {} } } }),
      this.prisma.quizAttempt.count(),
      this.prisma.lessonProgress.count({ where: { completed: true } }),
    ]);

    return {
      userCount,
      totalChats,
      knowledgeBaseCount,
      quizCount,
      quizAttemptCount,
      completedLessonCount,
    };
  }
}
