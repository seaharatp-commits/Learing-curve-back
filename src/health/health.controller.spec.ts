import "reflect-metadata";
import { INestApplication, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import * as http from "node:http";
import { HealthController } from "./health.controller";
import { PrismaService } from "../prisma/prisma.service";

type HttpJsonResponse = {
  statusCode: number;
  body: Record<string, unknown>;
};

const prisma = { $queryRaw: jest.fn() };

@Module({
  controllers: [HealthController],
  providers: [{ provide: PrismaService, useValue: prisma }],
})
class TestHealthModule {}

function getJson(url: string): Promise<HttpJsonResponse> {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        try {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
  });
}

describe("Health HTTP integration", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(TestHealthModule, { logger: false });
    app.setGlobalPrefix("api");
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prisma.$queryRaw.mockReset();
  });

  it("serves liveness without querying PostgreSQL", async () => {
    const response = await getJson(`${baseUrl}/api/health`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ status: "ok", check: "liveness" });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it("serves readiness only when the database query succeeds", async () => {
    prisma.$queryRaw.mockResolvedValue([{ result: 1 }]);

    const response = await getJson(`${baseUrl}/api/health/ready`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ status: "ok", check: "readiness", database: "ok" });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns 503 readiness when PostgreSQL is unavailable", async () => {
    prisma.$queryRaw.mockRejectedValue(new Error("database unavailable"));

    const response = await getJson(`${baseUrl}/api/health/ready`);

    expect(response.statusCode).toBe(503);
    expect(response.body).toMatchObject({
      status: "error",
      check: "readiness",
      database: "unavailable",
    });
  });
});
