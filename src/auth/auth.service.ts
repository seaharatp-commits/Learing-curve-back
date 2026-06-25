import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../prisma/prisma.service";
import { LoginDto } from "./dto/login.dto";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<{ accessToken: string; user: AuthenticatedUser }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException("อีเมลหรือรหัสผ่านไม่ถูกต้อง");

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) throw new UnauthorizedException("อีเมลหรือรหัสผ่านไม่ถูกต้อง");

    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };

    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return { accessToken, user: authenticatedUser };
  }

  async findById(id: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }
}
