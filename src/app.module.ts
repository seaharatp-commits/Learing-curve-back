import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { CommonModule } from "./common/common.module";
import { AuthModule } from "./auth/auth.module";
import { ChatModule } from "./chat/chat.module";
import { HistoryModule } from "./history/history.module";
import { IssuesModule } from "./issues/issues.module";
import { KnowledgeBaseModule } from "./knowledge-base/knowledge-base.module";
import { DashboardModule } from "./dashboard/dashboard.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CommonModule,
    AuthModule,
    ChatModule,
    HistoryModule,
    IssuesModule,
    KnowledgeBaseModule,
    DashboardModule,
  ],
})
export class AppModule {}
