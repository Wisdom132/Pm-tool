import { Role } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class InviteDto {
  @IsEmail({}, { message: 'That does not look like an email address.' })
  @MaxLength(320)
  email!: string;

  @IsEnum(Role, { message: 'Role must be admin or editor.' })
  role!: Role;

  /** Teams to place them in. The default team is always added as well. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  teamIds?: string[];
}

export class ChangeRoleDto {
  @IsEnum(Role, { message: 'Role must be admin or editor.' })
  role!: Role;
}
