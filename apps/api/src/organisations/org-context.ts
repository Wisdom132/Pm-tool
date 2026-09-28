import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  BadRequestException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Role } from '@prisma/client';
import { MembershipsRepository } from './memberships.repository';

export const ORG_HEADER = 'x-organisation-id';

export interface OrgContext {
  organisationId: string;
  role: Role;
}

/**
 * Which organisation this request is acting in, and whether the caller
 * belongs to it.
 *
 * Membership is checked here, once, rather than in each service. The risk
 * this guards is the one that matters most in a multi-tenant product: an id
 * supplied by the client being trusted, and one customer reading another
 * customer's source.
 */
@Injectable()
export class OrgGuard implements CanActivate {
  constructor(
    private readonly memberships: MembershipsRepository,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest<Request>();
    const session = (request as any).session;
    if (!session) throw new ForbiddenException('Sign in to continue.');

    const organisationId =
      (request.headers[ORG_HEADER] as string | undefined) ??
      (request.query.organisationId as string | undefined);

    if (!organisationId) {
      throw new BadRequestException(`Set the ${ORG_HEADER} header.`);
    }

    const membership = await this.memberships.find(organisationId, session.userId);

    // Not a member reads the same as not existing: confirming the id is real
    // would let someone enumerate other people's organisations.
    if (!membership) throw new ForbiddenException('No such organisation.');

    const required = this.reflector.getAllAndOverride<Role[]>('roles', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (required?.length && !required.includes(membership.role)) {
      throw new ForbiddenException('Only an admin can do that.');
    }

    (request as any).org = { organisationId, role: membership.role } satisfies OrgContext;
    return true;
  }
}

export const Org = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrgContext =>
    ctx.switchToHttp().getRequest().org,
);
