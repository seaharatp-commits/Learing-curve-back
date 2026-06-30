import { ConflictException, UnauthorizedException } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { AuthService } from "./auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { JwtService } from "@nestjs/jwt";

jest.mock("bcrypt", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

function makeService() {
  const prisma = {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  };
  const jwtService = { sign: jest.fn().mockReturnValue("jwt-token") };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    jwtService as unknown as JwtService,
  );
  return { service, prisma, jwtService };
}

describe("AuthService.login", () => {
  it("normalizes email and returns a signed token for valid credentials", async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      name: "User",
      role: "USER",
      passwordHash: "hash",
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const result = await service.login({ email: " User@Example.COM ", password: "secret1" });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: "user@example.com" } });
    expect(result).toEqual({
      accessToken: "jwt-token",
      user: { id: "user-1", email: "user@example.com", name: "User", role: "USER" },
    });
  });

  it("rejects invalid credentials", async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.login({ email: "missing@example.com", password: "secret1" })).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe("AuthService.register", () => {
  it("creates a fresh USER account with a hashed password", async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue(null);
    (bcrypt.hash as jest.Mock).mockResolvedValue("hashed-password");
    prisma.user.create.mockResolvedValue({
      id: "user-1",
      email: "new@example.com",
      name: "New User",
      role: "USER",
    });

    const result = await service.register({
      email: " New@Example.COM ",
      name: " New User ",
      password: "secret1",
    });

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        email: "new@example.com",
        name: "New User",
        passwordHash: "hashed-password",
        role: "USER",
      },
    });
    expect(result.user.role).toBe("USER");
    expect(result.accessToken).toBe("jwt-token");
  });

  it("rejects duplicate email addresses", async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({ id: "existing" });

    await expect(
      service.register({ email: "used@example.com", name: "Used", password: "secret1" }),
    ).rejects.toThrow(ConflictException);
  });
});
