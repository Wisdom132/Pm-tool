import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Whether the database answers at all.
   *
   * Deliberately the cheapest possible query. A health check that runs a
   * real one adds load exactly when the system is already struggling, and
   * turns a slow database into a failing probe into a restart loop.
   */
  async isReachable(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
