import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { HealthRepository } from './health.repository';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthRepository) {}

  /**
   * Reports the database too, not just that the process is up.
   * A health check that only proves Node is running is a health check that
   * stays green through an outage.
   */
  @Public()
  @Get()
  async check() {
    const up = await this.health.isReachable();
    return {
      status: up ? 'ok' : 'degraded',
      database: up ? 'up' : 'down',
      at: new Date().toISOString(),
    };
  }
}
