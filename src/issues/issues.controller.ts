import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt.strategy";
import { IssuesService } from "./issues.service";
import { CreateIssueDto } from "./dto/create-issue.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("issues")
export class IssuesController {
  constructor(private readonly issuesService: IssuesService) {}

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateIssueDto) {
    return this.issuesService.create(user.id, dto);
  }

  @Roles("ADMIN")
  @Get()
  list() {
    return this.issuesService.list();
  }
}
