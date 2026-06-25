import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { RequestUser } from "../auth/strategies/jwt.strategy";
import { KnowledgeBaseService } from "./knowledge-base.service";
import { KnowledgeBaseDto } from "./dto/knowledge-base.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("knowledge-base")
export class KnowledgeBaseController {
  constructor(private readonly knowledgeBaseService: KnowledgeBaseService) {}

  @Get()
  list() {
    return this.knowledgeBaseService.list();
  }

  @Roles("ADMIN")
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: KnowledgeBaseDto) {
    return this.knowledgeBaseService.create(user.id, dto);
  }

  @Roles("ADMIN")
  @Put(":id")
  update(@Param("id") id: string, @Body() dto: KnowledgeBaseDto) {
    return this.knowledgeBaseService.update(id, dto);
  }

  @Roles("ADMIN")
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.knowledgeBaseService.remove(id);
  }
}
