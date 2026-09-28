import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentSession {
  userId: string;
  email: string;
  sessionId: string;
  token: string;
}

/** The session the guard resolved, for a controller that wants it. */
export const Session = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentSession =>
    ctx.switchToHttp().getRequest().session,
);
