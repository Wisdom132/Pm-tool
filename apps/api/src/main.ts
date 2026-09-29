import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import cors from 'cors';
import { json } from 'express';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { initObservability } from './common/observability.js';
import { DomainErrorFilter } from './common/domain-error.filter';

async function bootstrap() {
  // Before the app, so a crash during startup is still reported. No-op
  // unless SENTRY_DSN is set, and tolerant of @sentry/node being absent.
  await initObservability();

  const app = await NestFactory.create(AppModule);

  /**
   * Two CORS policies, chosen by path.
   *
   * `enableCors` is deliberately not used, because one policy cannot serve
   * both callers:
   *
   * **The dashboard and the extension** send a session cookie. Their
   * origins must therefore be an allowlist — `Access-Control-Allow-Origin:
   * *` and credentials cannot be combined, and should not be.
   *
   * **The public widget** runs on customer domains we have never heard of,
   * so an allowlist cannot work: it would be a list nobody maintains, and
   * the first forgotten entry is a widget that silently stops working. It
   * sends no credentials at all, and that is what makes `*` safe here rather
   * than a hole — there is no ambient authority for a hostile page to
   * borrow, so a request is worth exactly what its body is worth, and every
   * check that matters is applied to the body.
   *
   * Picking between them in one middleware rather than layering two: mounted
   * as two, whichever ran second overwrote the first's
   * `Access-Control-Allow-Credentials`, and the combination a browser
   * actually refuses (`*` with credentials) is the one that resulted.
   */
  const credentialed = cors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:4300').split(','),
    credentials: true,
  });

  const anonymous = cors({
    origin: '*',
    credentials: false,
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    // A day, so a page leaving several comments is not re-preflighting on
    // every one of them.
    maxAge: 86_400,
  });

  app.use((req: IncomingMessage, res: ServerResponse, next: () => void) =>
    req.url?.startsWith('/api/public/') ? anonymous(req, res, next) : credentialed(req, res, next),
  );

  /**
   * Room for a screenshot.
   *
   * Express defaults to 100KB, which is under the 512KB the screenshot
   * column accepts — so every real screenshot was rejected with a 413
   * before validation ever saw it, and the size cap in the DTO was
   * unreachable code. A 512KB image is about 700KB once base64-encoded.
   *
   * Not larger than it needs to be: this is the ceiling on what an
   * unauthenticated request can make the server allocate.
   */
  app.use(json({ limit: '1mb' }));

  app.setGlobalPrefix('api');

  // Strip unknown fields rather than pass them on: a payload from a browser
  // extension is input, not a trusted DTO.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // Domain errors carry their own status and a message written for whoever
  // reads it. Without this they are all 500s saying "Internal server error".
  app.useGlobalFilters(new DomainErrorFilter());

  const port = Number(process.env.PORT ?? 3333);
  await app.listen(port);
  new Logger('bootstrap').log(`API listening on http://localhost:${port}/api`);
}

void bootstrap();
