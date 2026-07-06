import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt.strategy";
import { SkillRadarService } from "./skill-radar.service";

@UseGuards(JwtAuthGuard)
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
}
