import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt.strategy";
import { LearningService } from "./learning.service";
import { QuizService } from "./quiz.service";
import { GenerateTopicDto } from "./dto/generate-topic.dto";
import { GenerateLessonQuizDto } from "./dto/generate-lesson-quiz.dto";
import { AskLessonQuestionDto } from "./dto/ask-lesson-question.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
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
  generateLessonFromTopic(@CurrentUser() user: RequestUser, @Body() dto: GenerateTopicDto) {
    return this.quizService.generateFromTopic(user, dto.topic, dto.detail);
  }

  @Post("lessons/:id/chat")
  askLessonQuestion(
    @CurrentUser() user: RequestUser,
    @Param("id") id: string,
    @Body() dto: AskLessonQuestionDto,
  ) {
    return this.quizService.askLessonQuestion(user, id, dto.message, dto.chatHistory);
  }

  @Post("lessons/:id/quizzes/generate")
  @Roles("USER", "ADMIN")
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

  @Delete("lessons/:id")
  deleteLesson(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.learningService.deleteLesson(user, id);
  }
}
