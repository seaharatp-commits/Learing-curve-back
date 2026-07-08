import { Global, Module } from "@nestjs/common";
import { AiQuestionUnderstandingService } from "./ai-question-understanding.service";
import { AiService } from "./ai.service";

@Global()
@Module({
  providers: [AiService, AiQuestionUnderstandingService],
  exports: [AiService, AiQuestionUnderstandingService],
})
export class AiModule {}
