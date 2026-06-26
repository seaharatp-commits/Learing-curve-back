import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt.strategy";
import { LearningService } from "./learning.service";

@UseGuards(JwtAuthGuard)
@Controller("learning")
export class LearningController {
  constructor(private readonly learningService: LearningService) {}

  @Get("dashboard")
  getDashboard(@CurrentUser() user: RequestUser) {
    return this.learningService.getDashboard(user.id);
  }
}
