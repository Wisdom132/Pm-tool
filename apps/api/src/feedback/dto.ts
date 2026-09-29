import { Type } from 'class-transformer';
import { Trim } from '../common/trim';
import { FeedbackStatus } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class FeedbackQueryDto {
  @IsOptional()
  @IsEnum(FeedbackStatus, { message: 'status must be new, triaged or resolved.' })
  status?: FeedbackStatus;

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
}
