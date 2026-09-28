import { Injectable, Logger } from '@nestjs/common';

/**
 * Sending the sign-in link.
 *
 * In development it is logged rather than sent: a real provider means an API
 * key, a verified domain and a deliverability problem, none of which should
 * stand between someone cloning this and signing in.
 *
 * Swapping in Resend or Postmark is this one class.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  async sendSignInLink(email: string, url: string) {
    if (process.env.EMAIL_PROVIDER) {
      throw new Error(
        `EMAIL_PROVIDER=${process.env.EMAIL_PROVIDER} is set but no provider is wired up yet.`,
      );
    }

    this.logger.log(`Sign-in link for ${email}\n\n    ${url}\n`);
  }
}
