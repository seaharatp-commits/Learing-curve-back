import { Module } from "@nestjs/common";
import { KnowledgeBaseController } from "./knowledge-base.controller";
import { KnowledgeBaseService } from "./knowledge-base.service";
import { KnowledgeLearningService } from "./knowledge-learning.service";
import { RecommendationService } from "./recommendation.service";

@Module({
  controllers: [KnowledgeBaseController],
  providers: [KnowledgeBaseService, KnowledgeLearningService, RecommendationService],
  exports: [KnowledgeLearningService, RecommendationService],
})
export class KnowledgeBaseModule {}
