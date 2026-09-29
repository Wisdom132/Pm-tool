import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RequestLinkDto {
  @IsEmail({}, { message: 'That does not look like an email address.' })
  email!: string;
}

export class VerifyDto {
  @IsString()
  @MinLength(20)
  token!: string;
}

export class UpdateProfileDto {
  /**
   * How they appear in a pull request body.
   *
   * Empty clears it, which falls back to the local part of their address —
   * never the full address, because a change request can land in a public
   * repository.
   */
  @IsString()
  @MaxLength(120)
  name!: string;
}

export class CreateExtensionTokenDto {
  /** Shown in the token list, so one browser can be told from another. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}
