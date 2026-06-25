import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

export interface JwtPayload {
  sub: string;
  email: string;
  role: "USER" | "ADMIN";
}

export interface RequestUser {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>("JWT_SECRET") ?? "learning-curve-dev-secret",
    });
  }

  validate(payload: JwtPayload): RequestUser {
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
