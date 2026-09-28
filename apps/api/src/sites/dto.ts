import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateSiteDto {
  @IsString() @MinLength(3) @MaxLength(253)
  hostname!: string;

  @IsString() @MaxLength(80)
  name!: string;

  @IsIn(['production', 'staging', 'preview'])
  label!: 'production' | 'staging' | 'preview';

  @IsUUID()
  connectionId!: string;

  @IsString() @MaxLength(140)
  repository!: string;

  /** Omitted or null means "read the branch from the page" — preview deploys. */
  @IsOptional() @IsString() @MaxLength(255)
  branch?: string | null;
}

export class UpdateSiteDto {
  @IsOptional() @IsString() @MaxLength(80)
  name?: string;

  @IsOptional() @IsString() @MaxLength(255)
  branch?: string | null;
}

export class ResolveQueryDto {
  @IsString() @MinLength(3)
  hostname!: string;
}
