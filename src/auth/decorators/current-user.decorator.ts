import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { RequestUser } from "../strategies/jwt.strategy";

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestUser => {
  return ctx.switchToHttp().getRequest<{ user: RequestUser }>().user;
});
