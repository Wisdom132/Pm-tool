import { Module } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { TeamsRepository } from './teams.repository';
import { TeamsController } from './teams.controller';
import { OrganisationsModule } from '../organisations/organisations.module';

@Module({
  imports: [OrganisationsModule],
  controllers: [TeamsController],
  providers: [TeamsService, TeamsRepository],
  exports: [TeamsRepository],
})
export class TeamsModule {}
