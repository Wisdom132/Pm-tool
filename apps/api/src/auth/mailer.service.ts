import { Injectable, Logger } from '@nestjs/common';

/**
 * Sending the two emails this product needs.
 *
 * In development they are logged rather than sent: a real provider means an
 * API key, a verified domain and a deliverability problem, none of which
 * should stand between someone cloning this and signing in.
 *
 * Swapping in Resend or Postmark is this one class.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  async sendSignInLink(email: string, url: string) {
    this.assertProviderWired();
    this.logger.log(`Sign-in link for ${email}\n\n    ${url}\n`);
  }

  /**
   * The invitation link.
   *
   * Logged with the same prominence as a sign-in link, because in
   * development an admin inviting a colleague needs to be able to hand them
   * the URL — and because it is a bearer credential, so it must not go
   * anywhere else.
   */
  async sendInvitation(email: string, url: string) {
    this.assertProviderWired();
    this.logger.log(`Invitation for ${email}\n\n    ${url}\n`);
  }

  /**
   * Fail loudly rather than silently log in production.
   *
   * `EMAIL_PROVIDER` being set means somebody expected mail to be sent. If
   * it is not wired up, writing the link to the logs and reporting success
   * would leave an invitation that never arrives and no sign that anything
   * went wrong.
   */
  private assertProviderWired() {
    if (process.env.EMAIL_PROVIDER) {
      throw new Error(
        `EMAIL_PROVIDER=${process.env.EMAIL_PROVIDER} is set but no provider is wired up yet.`,
      );
    }
  }
}
