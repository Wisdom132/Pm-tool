import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { MailerService } from './mailer.service';
import { RateLimitGuard } from '../common/rate-limit.guard';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    MailerService,
    RateLimitGuard,
    // Global, so routes are protected by default and opting out is explicit.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, MailerService],
})
export class AuthModule {}
