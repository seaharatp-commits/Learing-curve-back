import "reflect-metadata";
import { INestApplication, Module, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import * as http from "node:http";
import { AuthModule } from "../auth/auth.module";
import { RolesGuard } from "../auth/guards/roles.guard";
import { PrismaModule } from "../prisma/prisma.module";
import { KnowledgeBaseController } from "./knowledge-base.controller";
import { KnowledgeBaseService } from "./knowledge-base.service";
import { KnowledgeLearningService } from "./knowledge-learning.service";
import { RecommendationService } from "./recommendation.service";

type HttpJsonResponse = {
  statusCode: number;
  body: Record<string, unknown>;
};

const knowledgeBaseService = {
  list: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
};
const knowledgeLearningService = { generateDraft: jest.fn(), confirmKnowledge: jest.fn() };
const recommendationService = { recommend: jest.fn() };

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [KnowledgeBaseController],
  providers: [
    RolesGuard,
    { provide: KnowledgeBaseService, useValue: knowledgeBaseService },
    { provide: KnowledgeLearningService, useValue: knowledgeLearningService },
    { provide: RecommendationService, useValue: recommendationService },
  ],
})
class TestKnowledgeBaseModule {}

function requestJson(
  url: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  accessToken: string,
  payload?: Record<string, unknown>,
): Promise<HttpJsonResponse> {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : undefined;
    const request = http.request(
      url,
      {
        method,
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}),
        },
      },
      (response) => {
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
      },
    );
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

describe("Knowledge Base HTTP integration", () => {
  let app: INestApplication;
  let baseUrl: string;
  let userToken: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await NestFactory.create(TestKnowledgeBaseModule, { logger: false });
    app.setGlobalPrefix("api");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0);
    baseUrl = await app.getUrl();
    const jwtService = app.get(JwtService);
    userToken = jwtService.sign({ sub: "user-1", email: "user@example.com", role: "USER" });
    adminToken = jwtService.sign({ sub: "admin-1", email: "admin@example.com", role: "ADMIN" });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects a USER from the admin knowledge-base list", async () => {
    const response = await requestJson(`${baseUrl}/api/knowledge-base`, "GET", userToken);

    expect(response.statusCode).toBe(403);
    expect(knowledgeBaseService.list).not.toHaveBeenCalled();
  });

  it("allows an ADMIN to list, create, update, and delete knowledge-base articles", async () => {
    knowledgeBaseService.list.mockResolvedValue([]);
    knowledgeBaseService.create.mockResolvedValue({ id: "kb-1", title: "Docker basics" });
    knowledgeBaseService.update.mockResolvedValue({ id: "kb-1", title: "Docker basics updated" });
    knowledgeBaseService.remove.mockResolvedValue({ success: true });

    const listResponse = await requestJson(`${baseUrl}/api/knowledge-base`, "GET", adminToken);
    const createResponse = await requestJson(`${baseUrl}/api/knowledge-base`, "POST", adminToken, {
      title: "Docker basics",
      category: "DevOps",
      content: "Run containers safely.",
    });
    const updateResponse = await requestJson(`${baseUrl}/api/knowledge-base/kb-1`, "PUT", adminToken, {
      title: "Docker basics updated",
      category: "DevOps",
      content: "Run containers safely and verify the result.",
    });
    const deleteResponse = await requestJson(`${baseUrl}/api/knowledge-base/kb-1`, "DELETE", adminToken);

    expect(listResponse.statusCode).toBe(200);
    expect(createResponse.statusCode).toBe(201);
    expect(updateResponse.statusCode).toBe(200);
    expect(deleteResponse.statusCode).toBe(200);
    expect(knowledgeBaseService.create).toHaveBeenCalledWith(
      "admin-1",
      expect.objectContaining({ title: "Docker basics", category: "DevOps" }),
    );
    expect(knowledgeBaseService.update).toHaveBeenCalledWith(
      "kb-1",
      expect.objectContaining({ title: "Docker basics updated", category: "DevOps" }),
    );
    expect(knowledgeBaseService.remove).toHaveBeenCalledWith("kb-1");
  });
});
