import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

/** Restrict a route to some roles. Enforced by OrgGuard. */
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);
