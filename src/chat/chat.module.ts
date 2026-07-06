import { Module } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { KnowledgeBaseModule } from "../knowledge-base/knowledge-base.module";
import { SkillRadarModule } from "../skill-radar/skill-radar.module";

@Module({
  imports: [KnowledgeBaseModule, SkillRadarModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
