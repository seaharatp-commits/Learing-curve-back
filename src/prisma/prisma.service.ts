import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log("Database connection established");
    } catch (error) {
      // Keep liveness available so the platform can report the database as
      // not ready instead of treating a temporary DB outage as an app crash.
      const message = error instanceof Error ? error.message : "unknown database error";
      this.logger.error(`Database connection unavailable at startup: ${message}`);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
