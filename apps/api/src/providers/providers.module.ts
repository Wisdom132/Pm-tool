import { Global, Module } from '@nestjs/common';
import { CredentialsService } from './credentials.service';
import { GithubAppService } from './github/github-app.service';
import { ProvidersService } from './providers.service';
import { ConnectionsModule } from '../connections/connections.module';
import { SitesModule } from '../sites/sites.module';

/**
 * Global, because both the connections endpoints and (shortly) the editing
 * endpoints need to open a repository, and threading this through every
 * feature module buys nothing.
 *
 * It imports the two feature modules whose repositories it reads. Those
 * modules do not import it back — they pick up its providers through
 * `@Global()` — so the module graph stays acyclic.
 */
@Global()
@Module({
  imports: [ConnectionsModule, SitesModule],
  providers: [CredentialsService, GithubAppService, ProvidersService],
  exports: [CredentialsService, GithubAppService, ProvidersService],
})
export class ProvidersModule {}
