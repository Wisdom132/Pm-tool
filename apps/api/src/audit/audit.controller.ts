import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto';
import { Org, OrgContext, OrgGuard } from '../organisations/org-context';
import { Roles } from '../organisations/roles.decorator';

/**
 * Admin-only. The log names who did what, which is more than an editor
 * needs and more than they should be able to enumerate.
 */
@Controller('audit')
@UseGuards(OrgGuard)
@Roles(Role.admin)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Org() org: OrgContext, @Query() query: AuditQueryDto) {
    return this.audit.list(org.organisationId, query);
  }

  /** Distinct actions present, for the filter dropdown. */
  @Get('actions')
  actions(@Org() org: OrgContext) {
    return this.audit.actions(org.organisationId);
  }
}
