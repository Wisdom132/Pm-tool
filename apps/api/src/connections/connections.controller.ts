import {
  Controller,
  Delete,
  Get,
  HttpException,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { Role } from '@prisma/client';
import { ConnectionsService } from './connections.service';
import { ProviderError } from '../providers/provider.types';
import { CheckConnectionDto, GithubCallbackQueryDto } from './dto';
import { Org, OrgContext, OrgGuard } from '../organisations/org-context';
import { Roles } from '../organisations/roles.decorator';
import { CurrentSession, Session } from '../auth/session.decorator';

@Controller('connections')
@UseGuards(OrgGuard)
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  @Get()
  list(@Org() org: OrgContext) {
    return this.connections.list(org.organisationId);
  }

  /**
   * Start a GitHub App install.
   *
   * Returns a URL rather than redirecting: the dashboard sends an XHR, and a
   * 302 in an XHR would be followed by the browser rather than shown to the
   * admin.
   */
  @Post('github/install-url')
  @Roles(Role.admin)
  installUrl(@Org() org: OrgContext, @Session() session: CurrentSession) {
    return this.connections.installUrl(org.organisationId, session.userId);
  }

  @Get(':id/repositories')
  repositories(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.connections.repositories(org.organisationId, id);
  }

  /** Branches of one repository, for the register-a-site dialog. */
  @Get(':id/branches')
  branches(
    @Org() org: OrgContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CheckConnectionDto,
  ) {
    return this.connections.branches(org.organisationId, id, query.repository);
  }

  /** Ask the provider something cheap, to prove the connection still works. */
  @Post(':id/check')
  check(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Query() query: CheckConnectionDto) {
    return this.connections.check(org.organisationId, id, query.repository);
  }

  @Delete(':id')
  @Roles(Role.admin)
  revoke(@Org() org: OrgContext, @Session() session: CurrentSession, @Param('id', ParseUUIDPipe) id: string) {
    return this.connections.revoke(org.organisationId, session.userId, id);
  }
}

/**
 * GitHub's redirect after an install, on its own controller.
 *
 * Deliberately outside OrgGuard: this request arrives from github.com and
 * carries no `x-organisation-id` header. Which organisation the installation
 * belongs to comes from the signed state, which is the only trustworthy
 * thing in the query string.
 *
 * It does still require a session — the cookie is `sameSite: 'lax'`, so it
 * is sent on a top-level GET navigation — so the callback needs both the
 * state *and* the browser of the person who started the flow.
 */
@Controller('connections/github')
export class GithubCallbackController {
  private readonly logger = new Logger(GithubCallbackController.name);

  constructor(private readonly connections: ConnectionsService) {}

  @Get('callback')
  async callback(
    @Session() session: CurrentSession,
    @Query() query: GithubCallbackQueryDto,
    @Res() res: Response,
  ) {
    const back = new URL('/connections', dashboardUrl());

    try {
      const connection = await this.connections.completeGithubInstall({
        installationId: query.installation_id,
        state: query.state,
        setupAction: query.setup_action,
        sessionUserId: session.userId,
      });
      back.searchParams.set('connected', connection.id);
    } catch (err) {
      // The admin is sitting on a GitHub redirect; a JSON error body would
      // be a dead end. Send them back to the page that started it with
      // something they can read.
      //
      // Only messages we wrote ourselves are passed through. Anything else
      // — a Prisma error, a stack from Octokit — would put internals in a
      // URL, and it would not tell the admin anything useful anyway.
      const safe =
        err instanceof HttpException || err instanceof ProviderError ? err.message : null;

      this.logger.warn(`GitHub install callback failed: ${(err as Error).message}`);
      back.searchParams.set('error', safe || 'The connection could not be completed. Please try again.');
    }

    res.redirect(back.toString());
  }
}

function dashboardUrl(): string {
  return process.env.DASHBOARD_URL ?? 'http://localhost:4200';
}
