import { Module } from "@nestjs/common";
import { KnowledgeBaseController } from "./knowledge-base.controller";
import { KnowledgeBaseService } from "./knowledge-base.service";
import { KnowledgeLearningService } from "./knowledge-learning.service";

@Module({
  controllers: [KnowledgeBaseController],
  providers: [KnowledgeBaseService, KnowledgeLearningService],
  exports: [KnowledgeLearningService],
})
export class KnowledgeBaseModule {}
