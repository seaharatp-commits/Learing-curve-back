import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt.strategy";
import { LearningService } from "./learning.service";
import { QuizService } from "./quiz.service";
import { GenerateTopicDto } from "./dto/generate-topic.dto";
import { GenerateLessonQuizDto } from "./dto/generate-lesson-quiz.dto";

@UseGuards(JwtAuthGuard)
@Controller("learning")
export class LearningController {
  constructor(
    private readonly learningService: LearningService,
    private readonly quizService: QuizService,
  ) {}

  @Get("dashboard")
  getDashboard(@CurrentUser() user: RequestUser) {
    return this.learningService.getDashboard(user);
  }

  @Get("lessons/:id")
  getLesson(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.learningService.getLesson(user, id);
  }

  @Post("lessons/generate-from-topic")
  generateLessonFromTopic(@CurrentUser() user: RequestUser, @Body() dto: GenerateTopicDto) 
  {
    return this.quizService.generateFromTopic(user, dto.topic);
  }

  @Post("lessons/:id/quizzes/generate")
  generateQuizFromLesson(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: GenerateLessonQuizDto,
  ) {
    return this.quizService.generateQuizFromLesson(user, id, dto.additionalPrompt);
  }

  @Post("lessons/:id/complete")
  markLessonCompleted(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.learningService.markLessonCompleted(user, id);
  }
}
