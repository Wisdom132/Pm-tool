import { Module } from '@nestjs/common';
import { MembersService } from './members.service';
import { MembersRepository } from './members.repository';
import { MembersController } from './members.controller';
import { OrganisationsModule } from '../organisations/organisations.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  // AuthModule for MailerService — an invitation is an email before it is
  // a row.
  imports: [OrganisationsModule, AuthModule],
  controllers: [MembersController],
  providers: [MembersService, MembersRepository],
  exports: [MembersRepository],
})
export class MembersModule {}
