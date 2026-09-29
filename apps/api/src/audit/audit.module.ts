import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditRepository } from './audit.repository';
import { AuditController } from './audit.controller';
import { OrganisationsModule } from '../organisations/organisations.module';

/**
 * Global so any feature can record a standalone event without an import.
 * Most events are written inside the transaction they belong to, in that
 * feature's own repository; this is for the rest.
 */
@Global()
@Module({
  imports: [OrganisationsModule],
  controllers: [AuditController],
  providers: [AuditService, AuditRepository],
  exports: [AuditRepository],
})
export class AuditModule {}
