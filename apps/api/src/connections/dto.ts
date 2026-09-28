import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class GithubCallbackQueryDto {
  /** GitHub sends this as a number; it arrives as a string in the query. */
  @IsString()
  @MaxLength(32)
  installation_id!: string;

  @IsString()
  @MaxLength(512)
  state!: string;

  /** "install" or "request" — an owner approval may still be pending. */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  setup_action?: string;
}

export class CheckConnectionDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  repository!: string;
}
