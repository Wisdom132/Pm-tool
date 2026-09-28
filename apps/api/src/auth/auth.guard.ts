import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { IS_PUBLIC } from './public.decorator';

export const SESSION_COOKIE = 'ie_session';

/**
 * Every route is protected unless it says otherwise.
 *
 * The default matters: a new controller that forgets to add a guard should
 * fail closed. Opting out is one visible decorator on the handler.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const request = ctx.switchToHttp().getRequest<Request>();
    const token = readToken(request);
    if (!token) throw new UnauthorizedException('Sign in to continue.');

    const session = await this.auth.resolveSession(token);
    if (!session) throw new UnauthorizedException('Your session has expired.');

    (request as any).session = {
      userId: session.userId,
      email: session.user.email,
      sessionId: session.id,
      token,
    };
    return true;
  }
}

/**
 * Cookie for the dashboard, bearer for the extension.
 *
 * The extension runs on the customer's own pages, where a cookie for our
 * domain is not available to it — so it holds a token instead.
 */
function readToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || null;

  const cookie = request.headers.cookie;
  if (!cookie) return null;

  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('=')) || null;
  }
  return null;
}
