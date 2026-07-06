import { Module } from "@nestjs/common";
import { SkillRadarController } from "./skill-radar.controller";
import { SkillRadarService } from "./skill-radar.service";

@Module({
  controllers: [SkillRadarController],
  providers: [SkillRadarService],
  exports: [SkillRadarService],
})
export class SkillRadarModule {}
