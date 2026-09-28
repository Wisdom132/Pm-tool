import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { SitesModule } from './sites/sites.module';
import { ProvidersModule } from './providers/providers.module';
import { ConnectionsModule } from './connections/connections.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    ProvidersModule,
    AuthModule,
    SitesModule,
    ConnectionsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
