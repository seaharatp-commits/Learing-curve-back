import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { CommonModule } from "./common/common.module";
import { AiModule } from "./ai/ai.module";
import { AuthModule } from "./auth/auth.module";
import { ChatModule } from "./chat/chat.module";
import { HistoryModule } from "./history/history.module";
import { KnowledgeBaseModule } from "./knowledge-base/knowledge-base.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { LearningModule } from "./learning/learning.module";
import { SkillRadarModule } from "./skill-radar/skill-radar.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CommonModule,
    AiModule,
    AuthModule,
    ChatModule,
    HistoryModule,
    KnowledgeBaseModule,
    DashboardModule,
    LearningModule,
    SkillRadarModule,
  ],
})
export class AppModule {}
