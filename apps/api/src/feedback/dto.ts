import { Type } from 'class-transformer';
import { FeedbackStatus } from '@prisma/client';
import {
  IsEnum,
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
