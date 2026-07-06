import { Body, Controller, Get, Param, Put, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt.strategy";
import { SkillRadarService } from "./skill-radar.service";
import { SetQuestionSkillsDto } from "./dto/set-question-skills.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("skill-radar")
export class SkillRadarController {
  constructor(private readonly skillRadarService: SkillRadarService) {}

  @Get("positions")
  listPositions() {
    return this.skillRadarService.listPositions();
  }

  @Get("positions/:id/skills")
  listSkills(@Param("id") id: string) {
    return this.skillRadarService.listSkills(id);
  }

  @Get("me")
  getMyRadar(@CurrentUser() user: RequestUser, @Query("positionId") positionId?: string) {
    return this.skillRadarService.getUserRadar(user.id, positionId);
  }

  @Roles("ADMIN")
  @Put("questions/:questionId/skills")
  setQuestionSkills(@Param("questionId") questionId: string, @Body() dto: SetQuestionSkillsDto) {
    return this.skillRadarService.setQuestionSkillMappings(questionId, dto);
  }
}
