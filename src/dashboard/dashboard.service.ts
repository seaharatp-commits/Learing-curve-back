import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const [totalChats, knowledgeBaseCount, quizCount] = await Promise.all([
      this.prisma.chatSession.count(),
      this.prisma.knowledgeBaseArticle.count(),
      this.prisma.quiz.count({ where: { questions: { some: {} } } }),
    ]);

    return {
      totalChats,
      knowledgeBaseCount,
      quizCount,
    };
  }
}
