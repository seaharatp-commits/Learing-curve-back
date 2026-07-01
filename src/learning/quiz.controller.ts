import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt.strategy";
import { QuizService } from "./quiz.service";
import { GenerateQuizDto } from "./dto/generate-quiz.dto";
import { SubmitAttemptDto } from "./dto/submit-attempt.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("learning/quizzes")
export class QuizController {
  constructor(private readonly quizService: QuizService) {}

  @Roles("ADMIN")
  @Post("generate-from-article")
  generate(@CurrentUser() user: RequestUser, @Body() dto: GenerateQuizDto) {
    return this.quizService.generateFromArticle(user, dto.articleId);
  }

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.quizService.list(user);
  }

  @Get(":id")
  getForAttempt(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.quizService.getForAttempt(user, id);
  }

  @Delete(":id")
  remove(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.quizService.remove(user, id);
  }

  @Post(":id/attempts")
  submitAttempt(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: SubmitAttemptDto,
  ) {
    return this.quizService.submitAttempt(user, id, dto);
  }
}
