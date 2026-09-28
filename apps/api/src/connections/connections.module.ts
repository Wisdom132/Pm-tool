import { Module } from '@nestjs/common';
import { ConnectionsService } from './connections.service';
import { ConnectionsRepository } from './connections.repository';
import { ConnectionsController, GithubCallbackController } from './connections.controller';
import { OrganisationsModule } from '../organisations/organisations.module';

/**
 * Note the asymmetry with ProvidersModule: this module does *not* import it,
 * because it is `@Global()`. That is deliberate — ProvidersModule imports
 * this one for `ConnectionsRepository`, and an import in both directions
 * would be a cycle Nest would need `forwardRef` to untangle.
 */
@Module({
  imports: [OrganisationsModule],
  controllers: [ConnectionsController, GithubCallbackController],
  providers: [ConnectionsService, ConnectionsRepository],
  exports: [ConnectionsService, ConnectionsRepository],
})
export class ConnectionsModule {}
