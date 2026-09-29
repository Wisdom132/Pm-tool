import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { CreateExtensionTokenDto, RequestLinkDto, UpdateProfileDto, VerifyDto } from './dto';
import { Public } from './public.decorator';
import { SESSION_COOKIE } from './auth.guard';
import { CurrentSession, Session } from './session.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('request-link')
  requestLink(@Body() dto: RequestLinkDto) {
    const appUrl = process.env.APP_URL ?? 'http://localhost:4300';
    return this.auth.requestLink(dto.email, appUrl);
  }

  @Public()
  @Post('verify')
  async verify(@Body() dto: VerifyDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, sessionToken } = await this.auth.verify(dto.token, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });

    // httpOnly so a script on the page cannot read it, sameSite lax so the
    // link in the email still works when it lands from a mail client.
    res.cookie(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 86_400_000,
      path: '/',
    });

    return { user: { id: user.id, email: user.email, name: user.name } };
  }

  /** Who am I, and what can I see. The dashboard calls this on boot. */
  @Get('me')
  me(@Session() session: CurrentSession) {
    return this.auth.describe(session.userId);
  }

  @Patch('me')
  updateProfile(@Session() session: CurrentSession, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(session.userId, dto.name);
  }

  /**
   * A token for the browser extension, shown once.
   *
   * Only the hash is stored, so it cannot be shown again — which is what
   * makes it safe to hand out and forget.
   */
  @Post('extension-tokens')
  createExtensionToken(@Session() session: CurrentSession, @Body() dto: CreateExtensionTokenDto) {
    return this.auth.createExtensionToken(session.userId, dto.label);
  }

  @Get('extension-tokens')
  listExtensionTokens(@Session() session: CurrentSession) {
    return this.auth.listExtensionTokens(session.userId);
  }

  @Delete('extension-tokens/:id')
  revokeExtensionToken(
    @Session() session: CurrentSession,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.auth.revokeToken(session.userId, id);
  }

  @Post('sign-out')
  async signOut(@Session() session: CurrentSession, @Res({ passthrough: true }) res: Response) {
    await this.auth.revokeSession(session.token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { signedOut: true };
  }

  /** Ends every other session, keeping this one. */
  @Post('sign-out-everywhere')
  async signOutEverywhere(@Session() session: CurrentSession) {
    await this.auth.revokeAllSessions(session.userId, session.token);
    return { signedOut: true };
  }
}
