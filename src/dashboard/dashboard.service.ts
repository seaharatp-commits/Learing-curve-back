import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const [
      totalChats,
      totalIssues,
      openIssues,
      resolvedIssues,
      knowledgeBaseCount,
      quizCount,
      issueGroups,
    ] = await Promise.all([
      this.prisma.chatSession.count(),
      this.prisma.issueReport.count(),
      this.prisma.issueReport.count({ where: { status: "OPEN" } }),
      this.prisma.issueReport.count({ where: { status: "RESOLVED" } }),
      this.prisma.knowledgeBaseArticle.count(),
      this.prisma.quiz.count({ where: { questions: { some: {} } } }),
      this.prisma.issueReport.groupBy({
        by: ["categoryId"],
        _count: { _all: true },
      }),
    ]);

    const categories = await this.prisma.category.findMany({
      where: { id: { in: issueGroups.map((group) => group.categoryId) } },
    });
    const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));

    return {
      totalChats,
      totalIssues,
      openIssues,
      resolvedIssues,
      knowledgeBaseCount,
      quizCount,
      issuesByCategory: issueGroups.map((group) => ({
        category: categoryNameById.get(group.categoryId) ?? "ไม่ระบุ",
        count: group._count._all,
      })),
    };
  }
}
