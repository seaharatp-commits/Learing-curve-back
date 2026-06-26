import { Module } from "@nestjs/common";
import { KnowledgeBaseModule } from "../knowledge-base/knowledge-base.module";
import { IssuesController } from "./issues.controller";
import { IssuesService } from "./issues.service";

@Module({
  imports: [KnowledgeBaseModule],
  controllers: [IssuesController],
  providers: [IssuesService],
})
export class IssuesModule {}
