import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CategoriesService } from "../common/categories.service";
import { CreateIssueDto } from "./dto/create-issue.dto";

@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categoriesService: CategoriesService,
  ) {}

  async create(reporterId: string, dto: CreateIssueDto) {
    const category = await this.categoriesService.resolveByName(dto.category);
    return this.prisma.issueReport.create({
      data: {
        title: dto.title,
        description: dto.description,
        priority: dto.priority,
        categoryId: category.id,
        reporterId,
      },
      include: { category: true },
    });
  }

  async list() {
    const issues = await this.prisma.issueReport.findMany({
      orderBy: { createdAt: "desc" },
      include: { category: true, reporter: true },
    });

    return issues.map((issue) => ({
      id: issue.id,
      title: issue.title,
      description: issue.description,
      category: issue.category.name,
      priority: issue.priority,
      status: issue.status,
      reporterName: issue.reporter.name,
      reporterEmail: issue.reporter.email,
      createdAt: issue.createdAt,
    }));
  }
}
