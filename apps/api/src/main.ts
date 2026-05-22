import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";

const envPath = [join(process.cwd(), "apps/api/.env"), join(process.cwd(), ".env")].find((path) =>
  existsSync(path)
);
config(envPath ? { path: envPath } : undefined);

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";

  app.enableCors({
    origin: webOrigin,
    credentials: true
  });
  app.use(cookieParser(process.env.SESSION_SECRET));
  app.useStaticAssets(join(process.cwd(), "uploads"), {
    prefix: "/uploads/"
  });

  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
