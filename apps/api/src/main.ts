import 'reflect-metadata';
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

  // The extension talks to this from whatever origin the customer's site is
  // on, so CORS is not optional here — but it is scoped to the dashboard and
  // to credentialed requests rather than left open.
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:4300').split(','),
    credentials: true,
  });

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
