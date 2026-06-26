import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt.strategy";
import { KnowledgeBaseService } from "./knowledge-base.service";
import { KnowledgeBaseDto } from "./dto/knowledge-base.dto";
import { RecommendQueryDto } from "./dto/recommend-query.dto";
import { GenerateKnowledgeDto } from "./dto/generate-knowledge.dto";
import { ConfirmKnowledgeDto } from "./dto/confirm-knowledge.dto";
import { RecommendationService } from "./recommendation.service";
import { KnowledgeLearningService } from "./knowledge-learning.service";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("knowledge-base")
export class KnowledgeBaseController {
  constructor(
    private readonly knowledgeBaseService: KnowledgeBaseService,
    private readonly recommendationService: RecommendationService,
    private readonly knowledgeLearningService: KnowledgeLearningService,
  ) {}

  @Get()
  list() {
    return this.knowledgeBaseService.list();
  }

  @Post("recommend")
  recommend(@Body() dto: RecommendQueryDto) {
    return this.recommendationService.recommend(dto);
  }

  @Roles("ADMIN")
  @Post("generate")
  generate(@Body() dto: GenerateKnowledgeDto) {
    return this.knowledgeLearningService.generateDraft(dto.text);
  }

  @Roles("ADMIN")
  @Post("confirm")
  confirm(@CurrentUser() user: RequestUser, @Body() dto: ConfirmKnowledgeDto) {
    return this.knowledgeLearningService.confirmKnowledge(dto, user.id);
  }

  @Roles("ADMIN")
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: KnowledgeBaseDto) {
    return this.knowledgeBaseService.create(user.id, dto);
  }

  @Roles("ADMIN")
  @Put(":id")
  update(@Param("id") id: string, @Body() dto: KnowledgeBaseDto) {
    return this.knowledgeBaseService.update(id, dto);
  }

  @Roles("ADMIN")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.knowledgeBaseService.remove(id);
  }
}
