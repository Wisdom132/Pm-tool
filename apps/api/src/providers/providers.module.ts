import { Global, Module } from '@nestjs/common';
import { CredentialsService } from './credentials.service';
import { GithubAppService } from './github/github-app.service';
import { ProvidersService } from './providers.service';

/**
 * Global, because both the connections endpoints and (shortly) the editing
 * endpoints need to open a repository, and threading the module through
 * every feature buys nothing.
 */
@Global()
@Module({
  providers: [CredentialsService, GithubAppService, ProvidersService],
  exports: [CredentialsService, GithubAppService, ProvidersService],
})
export class ProvidersModule {}
