import { Module } from "@nestjs/common";
import { LearningController } from "./learning.controller";
import { LearningService } from "./learning.service";
import { QuizController } from "./quiz.controller";
import { QuizService } from "./quiz.service";

@Module({
  controllers: [LearningController, QuizController],
  providers: [LearningService, QuizService],
})
export class LearningModule {}
