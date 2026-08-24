import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix("api");
  const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000,https://learning.develyst.online")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  app.enableCors({ origin: allowedOrigins, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = process.env.PORT ?? 3333;
  await app.listen(port);
  console.log(`Learning Curve backend listening on http://localhost:${port}/api`);
}

bootstrap();
