import { Injectable } from '@nestjs/common';
import { type Memberships } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Who belongs to which organisation.
 *
 * Its own repository, and its own module, because it is read on the hot
 * path — `OrgGuard` calls `find` on every tenant-scoped request — and
 * because three unrelated features ask the same question. One owner means
 * the index that query depends on has one obvious place to be reasoned
 * about.
 */
@Injectable()
export class MembershipsRepository {
  constructor(private readonly prisma: PrismaService) {}

  find(organisationId: string, userId: string): Promise<Memberships | null> {
    return this.prisma.memberships.findUnique({
      where: { organisationId_userId: { organisationId, userId } },
    });
  }

  listForUser(userId: string) {
    return this.prisma.memberships.findMany({
      where: { userId },
      select: { organisationId: true, role: true },
    });
  }
}
