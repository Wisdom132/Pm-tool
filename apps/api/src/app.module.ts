import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { OrganisationsModule } from './organisations/organisations.module';
import { AuditModule } from './audit/audit.module';
import { ProvidersModule } from './providers/providers.module';
import { AuthModule } from './auth/auth.module';
import { SitesModule } from './sites/sites.module';
import { ConnectionsModule } from './connections/connections.module';
import { TeamsModule } from './teams/teams.module';
import { MembersModule } from './members/members.module';
import { FeedbackModule } from './feedback/feedback.module';
import { EditingModule } from './editing/editing.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    OrganisationsModule,
    AuditModule,
    ProvidersModule,
    AuthModule,
    SitesModule,
    ConnectionsModule,
    TeamsModule,
    MembersModule,
    FeedbackModule,
    EditingModule,
    HealthModule,
  ],
})
export class AppModule {}
