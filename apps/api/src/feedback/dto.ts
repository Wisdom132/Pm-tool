import { Type } from 'class-transformer';
import { Trim } from '../common/trim';
import { FeedbackSource, FeedbackStatus } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * The largest screenshot a request may carry, as base64.
 *
 * Mirrors `MAX_SCREENSHOT_BYTES` with the 4/3 encoding overhead. Checked
 * here as well as in `decodeScreenshot` so an oversized payload is refused
 * by validation, before any of it reaches a service.
 */
const MAX_SCREENSHOT_CHARS = Math.ceil((512 * 1024 * 4) / 3) + 64;

export class FeedbackQueryDto {
  @IsOptional()
  @IsEnum(FeedbackStatus, { message: 'status must be new, triaged or resolved.' })
  status?: FeedbackStatus;

  @IsOptional()
  @IsEnum(FeedbackSource, { message: 'source must be extension or widget.' })
  source?: FeedbackSource;

  /**
   * A user id, `me`, or `none` for the unassigned queue.
   *
   * `me` is resolved server-side from the session rather than by the client
   * sending its own id, so the filter cannot be pointed at somebody else by
   * guessing one.
   */
  @IsOptional()
  @Matches(/^(me|none|[0-9a-f-]{36})$/i, {
    message: 'assignedTo must be a user id, "me" or "none".',
  })
  assignedTo?: string;

  @IsOptional()
  @IsUUID()
  siteId?: string;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class SetFeedbackStatusDto {
  @IsEnum(FeedbackStatus, { message: 'status must be new, triaged or resolved.' })
  status!: FeedbackStatus;
}

export class PromoteFeedbackDto {
  /** The issue or change request it became. */
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  @MaxLength(2000)
  url!: string;
}

export class AssignFeedbackDto {
  /**
   * Who is dealing with it, or null to put it back down.
   *
   * `ValidateIf` rather than `IsOptional`, because an explicit null is the
   * unassign instruction and `IsOptional` would skip validation for it —
   * meaning an absent field and a null field would be indistinguishable.
   */
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  assigneeId!: string | null;
}

/**
 * A comment left from the extension.
 *
 * No `siteId` and no `organisationId`: those come from the environment, the
 * same way editing works. A page that could name its own site could file
 * feedback against somebody else's.
 */
export class CreateFeedbackDto {
  @IsUUID()
  environmentId!: string;

  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Say something — an empty comment helps nobody.' })
  @MaxLength(5000)
  message!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  pageUrl!: string;

  /** A CSS selector, for re-finding the element later. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  element?: string;

  /** From the build annotation. The thing no general feedback tool has. */
  @IsOptional()
  @IsString()
  @MaxLength(400)
  sourceFile?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sourceLine?: number;

  /** "1440x900" — context nobody types. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  viewport?: string;

  /**
   * A `data:image/...;base64,...` screenshot.
   *
   * No `userAgent` field beside it, on purpose: that is read from the
   * request header. A client that declares its own browser can declare any
   * browser, and a value the reporter chose is worth less than no value
   * because it looks like evidence.
   */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SCREENSHOT_CHARS, { message: 'The screenshot is too large.' })
  screenshot?: string;
}

/**
 * A comment from the public widget.
 *
 * The differences from `CreateFeedbackDto` are the whole security story:
 * there is no `environmentId`, because there is no session to authorise one
 * against — the site is found from the page URL's hostname, and only if it
 * verified its domain and switched the widget on.
 *
 * The author fields are free text and are never matched to a `User`. A
 * visitor typing "ada@acme.com" into a box proves nothing, and the inbox
 * shows it as unverified.
 */
export class PublicFeedbackDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'Say something — an empty comment helps nobody.' })
  @MaxLength(5000)
  message!: string;

  /** Which page. This is also what identifies the site. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  pageUrl!: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  authorName?: string;

  /**
   * Optional, and unverified. Its only purpose is letting somebody reply.
   *
   * `ValidateIf` lets an empty string through as "not given" rather than
   * failing the whole submission — a visitor who tabs through the field
   * and leaves it blank should not lose what they wrote.
   */
  @ValidateIf((_, value) => value !== undefined && value !== '')
  @IsEmail({}, { message: 'That email address is not valid.' })
  @MaxLength(200)
  authorEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  element?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  sourceFile?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sourceLine?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  viewport?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_SCREENSHOT_CHARS, { message: 'The screenshot is too large.' })
  screenshot?: string;
}
