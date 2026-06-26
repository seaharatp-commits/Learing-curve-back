import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt.strategy";
import { IssuesService } from "./issues.service";
import { CreateIssueDto } from "./dto/create-issue.dto";
import { KnowledgeLearningService } from "../knowledge-base/knowledge-learning.service";
import { RecommendationService } from "../knowledge-base/recommendation.service";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("issues")
export class IssuesController {
  constructor(
    private readonly issuesService: IssuesService,
    private readonly knowledgeLearningService: KnowledgeLearningService,
    private readonly recommendationService: RecommendationService,
  ) {}

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateIssueDto) {
    return this.issuesService.create(user.id, dto);
  }

  @Roles("ADMIN")
  @Get()
  list() {
    return this.issuesService.list();
  }

  @Roles("ADMIN")
  @Post(":id/learn")
  learn(@Param("id") id: string) {
    return this.knowledgeLearningService.learnFromIssue(id);
  }

  @Roles("ADMIN")
  @Get(":id/recommendations")
  async recommendations(@Param("id") id: string) {
    const issue = await this.issuesService.findOne(id);
    return this.recommendationService.recommend({
      title: issue.title,
      description: issue.description,
      category: issue.category.name,
    });
  }
}
