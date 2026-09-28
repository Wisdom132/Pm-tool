import { IsEmail, IsString, MinLength } from 'class-validator';

export class RequestLinkDto {
  @IsEmail({}, { message: 'That does not look like an email address.' })
  email!: string;
}

export class VerifyDto {
  @IsString()
  @MinLength(20)
  token!: string;
}
