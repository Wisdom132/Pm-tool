import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Response } from 'express';
import { hit, LIMITS, type Limit } from './rate-limit';

const BUCKET = 'rateLimitBucket';

/**
 * Rate limit a route.
 *
 * @example @RateLimit('write') on a handler that opens a pull request.
 */
export const RateLimit = (bucket: keyof typeof LIMITS) => SetMetadata(BUCKET, bucket);

/**
 * Counts per user, and — for writes — per repository as well.
 *
 * The second bucket matters: limiting only per user means one noisy editor
 * can still exhaust an organisation's provider quota, and the people who
 * notice are their colleagues.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const bucket = this.reflector.getAllAndOverride<keyof typeof LIMITS>(BUCKET, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!bucket) return true;

    const request = ctx.switchToHttp().getRequest();
    const response = ctx.switchToHttp().getResponse<Response>();
    const config: Limit = LIMITS[bucket];

    const userId = request.session?.userId ?? request.ip ?? 'anonymous';
    const verdict = hit(bucket, userId, config);

    response.setHeader('X-RateLimit-Limit', String(verdict.limit));
    response.setHeader('X-RateLimit-Remaining', String(verdict.remaining));

    if (!verdict.allowed) {
      response.setHeader('Retry-After', String(verdict.retryAfter));
      throw new HttpException(
        `Rate limit exceeded. Try again in ${verdict.retryAfter}s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // A second bucket keyed on the site being edited. Checked after the
    // per-user one so a single client cannot spend someone else's budget
    // before its own.
    const environmentId = request.body?.environmentId ?? request.query?.environmentId;
    if (bucket === 'write' && environmentId) {
      const shared = hit(`${bucket}:site`, String(environmentId), config);
      if (!shared.allowed) {
        response.setHeader('Retry-After', String(shared.retryAfter));
        throw new HttpException(
          `This site has reached its hourly limit for new changes. Try again in ${shared.retryAfter}s.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    return true;
  }
}
