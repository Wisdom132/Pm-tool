import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ProviderError } from '../providers/provider.types';
import { InvalidSourcePath } from '../editing/source-path';

/**
 * Give the domain's own errors an honest HTTP status.
 *
 * Without this they are plain `Error` subclasses, so Nest maps every one to
 * **500 Internal Server Error** — which is wrong twice over. It tells the
 * caller we broke when in fact they sent something invalid, and it replaces
 * a message written for the person reading it ("this path traverses outside
 * the repository", "the App is no longer installed") with "Internal server
 * error".
 *
 * That was not hypothetical: path traversal *was* correctly refused, and
 * reported as a 500 that looked like a crash.
 */
@Catch(ProviderError, InvalidSourcePath)
export class DomainErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainErrorFilter.name);

  catch(error: ProviderError | InvalidSourcePath, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = statusFor(error);

    // 5xx means we are at fault, so it is worth a log line; a 4xx is the
    // caller being told something they can fix.
    if (status >= 500) {
      this.logger.error(`${error.name}: ${error.message}`);
    } else {
      this.logger.debug(`${error.name}: ${error.message}`);
    }

    response.status(status).json({
      statusCode: status,
      message: error.message,
      error: error.name,
    });
  }
}

function statusFor(error: ProviderError | InvalidSourcePath): number {
  if (error instanceof InvalidSourcePath) return HttpStatus.BAD_REQUEST;

  switch (error.code) {
    case 'not-found':
      return HttpStatus.NOT_FOUND;
    // The caller did nothing wrong, but they cannot proceed until an admin
    // reconnects — a 409 says "the world is in the wrong state", which is
    // exactly the situation.
    case 'not-installed':
      return HttpStatus.CONFLICT;
    case 'forbidden':
      return HttpStatus.FORBIDDEN;
    case 'conflict':
      return HttpStatus.CONFLICT;
    case 'rate-limited':
      return HttpStatus.TOO_MANY_REQUESTS;
    // Not 500: the failure is upstream at the provider, and saying so stops
    // a GitHub outage from reading as a bug in this service.
    case 'unavailable':
      return HttpStatus.BAD_GATEWAY;
    default:
      return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}

/** Kept for symmetry with `HttpException`, which Nest already handles. */
export const isHandled = (error: unknown): boolean =>
  error instanceof HttpException ||
  error instanceof ProviderError ||
  error instanceof InvalidSourcePath;
