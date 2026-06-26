import { Controller, Delete, Get, Param, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt.strategy";
import { HistoryService } from "./history.service";

@UseGuards(JwtAuthGuard)
@Controller("history")
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.historyService.list(user.id);
  }

  @Delete(":sessionId")
  remove(@CurrentUser() user: RequestUser, @Param("sessionId") sessionId: string) {
    return this.historyService.remove(user.id, sessionId);
  }
}
