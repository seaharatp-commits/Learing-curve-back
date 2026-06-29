import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt.strategy";
import { QuizService } from "./quiz.service";
import { GenerateQuizDto } from "./dto/generate-quiz.dto";
import { GenerateTopicDto } from "./dto/generate-topic.dto";
import { SubmitAttemptDto } from "./dto/submit-attempt.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("learning/quizzes")
export class QuizController {
  constructor(private readonly quizService: QuizService) {}

  @Roles("ADMIN")
  @Post("generate-from-article")
  generate(@Body() dto: GenerateQuizDto) {
    return this.quizService.generateFromArticle(dto.articleId);
  }

  @Post("generate-from-topic")
  generateFromTopic(@Body() dto: GenerateTopicDto) {
    return this.quizService.generateFromTopic(dto.topic);
  }

  @Get()
  list() {
    return this.quizService.list();
  }

  @Get(":id")
  getForAttempt(@Param("id") id: string) {
    return this.quizService.getForAttempt(id);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.quizService.remove(id);
  }

  @Post(":id/attempts")
  submitAttempt(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: SubmitAttemptDto,
  ) {
    return this.quizService.submitAttempt(user.id, id, dto);
  }
}
