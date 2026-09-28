import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentSession {
  userId: string;
  email: string;
  /**
   * How to name this person in something published — a pull request body,
   * an issue. Their own name when they have set one, otherwise the local
   * part of their address.
   *
   * Never the full email address: a change request can land in a public
   * repository, where it is permanent and indexed. "ada" is enough for a
   * reviewer to know who to ask; "ada@acme.com" is a disclosure.
   */
  displayName: string;
  sessionId: string;
  token: string;
}

/** The session the guard resolved, for a controller that wants it. */
export const Session = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentSession =>
    ctx.switchToHttp().getRequest().session,
);
