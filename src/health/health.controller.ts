import { Controller, Get, Logger, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Controller("health")
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  check() {
    return {
      status: "ok",
      check: "liveness",
      service: "learning-curve-backend",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("ready")
  async readiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: "ok",
        check: "readiness",
        service: "learning-curve-backend",
        database: "ok",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown database error";
      this.logger.warn(`Readiness check failed: ${message}`);
      throw new ServiceUnavailableException({
        status: "error",
        check: "readiness",
        service: "learning-curve-backend",
        database: "unavailable",
        timestamp: new Date().toISOString(),
      });
    }
  }
}
