import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../prisma/prisma.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";

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
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
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

  async register(dto: RegisterDto): Promise<{ accessToken: string; user: AuthenticatedUser }> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) throw new ConflictException("อีเมลนี้ถูกใช้งานแล้ว");

    const user = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        name: dto.name.trim(),
        passwordHash: await bcrypt.hash(dto.password, 10),
        role: "USER",
      },
    });

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
