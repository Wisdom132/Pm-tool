import {
  IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Trim } from '../common/trim';

export class CreateSiteDto {
  @Trim() @IsString() @MinLength(3) @MaxLength(253)
  hostname!: string;

  // Allowed to be blank: the service falls back to the hostname.
  @Trim() @IsString() @MaxLength(80)
  name!: string;

  @IsIn(['production', 'staging', 'preview'])
  label!: 'production' | 'staging' | 'preview';

  @IsUUID()
  connectionId!: string;

  // MinLength, not just MaxLength: an empty repository was accepted with a
  // 201 and then failed on every edit, which is the worst place to find out.
  @Trim() @IsString() @MinLength(3) @MaxLength(140)
  repository!: string;

  /** Omitted or null means "read the branch from the page" — preview deploys. */
  @IsOptional() @IsString() @MaxLength(255)
  branch?: string | null;

  /**
   * The public feedback widget.
   *
   * Turning it on opens an endpoint that accepts comments and screenshots
   * from anyone who can load the page, so it is a decision somebody makes
   * rather than a thing that happens to be true because the site exists.
   * Turning it off takes effect on the next request — it is the off switch.
   */
  @IsOptional() @IsBoolean()
  feedbackWidget?: boolean;
}

export class UpdateSiteDto {
  @IsOptional() @Trim() @IsString() @MaxLength(80)
  name?: string;

  @IsOptional() @IsString() @MaxLength(255)
  branch?: string | null;

  /**
   * The public feedback widget.
   *
   * Turning it on opens an endpoint that accepts comments and screenshots
   * from anyone who can load the page, so it is a decision somebody makes
   * rather than a thing that happens to be true because the site exists.
   * Turning it off takes effect on the next request — it is the off switch.
   */
  @IsOptional() @IsBoolean()
  feedbackWidget?: boolean;
}

export class ResolveQueryDto {
  @Trim() @IsString() @MinLength(3)
  hostname!: string;
}
