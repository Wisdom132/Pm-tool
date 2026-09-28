import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { OrganisationsModule } from './organisations/organisations.module';
import { ProvidersModule } from './providers/providers.module';
import { AuthModule } from './auth/auth.module';
import { SitesModule } from './sites/sites.module';
import { ConnectionsModule } from './connections/connections.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    OrganisationsModule,
    ProvidersModule,
    AuthModule,
    SitesModule,
    ConnectionsModule,
    HealthModule,
  ],
})
export class AppModule {}
