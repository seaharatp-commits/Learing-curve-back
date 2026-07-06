import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt.strategy";
import { SkillRadarService } from "./skill-radar.service";
import { PositionDto } from "./dto/position.dto";
import { PositionSkillDto } from "./dto/position-skill.dto";
import { SetQuestionSkillsDto } from "./dto/set-question-skills.dto";
import { UpdateMyPositionDto } from "./dto/update-my-position.dto";

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

  @Put("me/position")
  updateMyPosition(@CurrentUser() user: RequestUser, @Body() dto: UpdateMyPositionDto) {
    return this.skillRadarService.updateMyPosition(user.id, dto);
  }

  @Roles("ADMIN")
  @Get("admin/positions")
  listAdminPositions() {
    return this.skillRadarService.listAdminPositions();
  }

  @Roles("ADMIN")
  @Get("admin/events")
  listAdminSkillScoreEvents(@Query("limit") limit?: string) {
    return this.skillRadarService.listAdminSkillScoreEvents(Number(limit) || 30);
  }

  @Roles("ADMIN")
  @Post("admin/positions")
  createPosition(@Body() dto: PositionDto) {
    return this.skillRadarService.createPosition(dto);
  }

  @Roles("ADMIN")
  @Patch("admin/positions/:id")
  updatePosition(@Param("id") id: string, @Body() dto: PositionDto) {
    return this.skillRadarService.updatePosition(id, dto);
  }

  @Roles("ADMIN")
  @Post("admin/positions/:id/skills")
  createSkill(@Param("id") id: string, @Body() dto: PositionSkillDto) {
    return this.skillRadarService.createSkill(id, dto);
  }

  @Roles("ADMIN")
  @Patch("admin/skills/:id")
  updateSkill(@Param("id") id: string, @Body() dto: PositionSkillDto) {
    return this.skillRadarService.updateSkill(id, dto);
  }

  @Roles("ADMIN")
  @Get("questions/:questionId/skill-suggestions")
  suggestQuestionSkills(@Param("questionId") questionId: string) {
    return this.skillRadarService.suggestQuestionSkillMappings(questionId);
  }

  @Roles("ADMIN")
  @Put("questions/:questionId/skills")
  setQuestionSkills(@Param("questionId") questionId: string, @Body() dto: SetQuestionSkillsDto) {
    return this.skillRadarService.setQuestionSkillMappings(questionId, dto);
  }
}
