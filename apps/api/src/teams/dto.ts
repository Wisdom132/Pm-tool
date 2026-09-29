import { ArrayMaxSize, IsArray, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateTeamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}

export class RenameTeamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}

export class SetMembersDto {
  /** The whole set, not a delta — see TeamsRepository.setMembers. */
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  memberIds!: string[];
}

export class SetSitesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  siteIds!: string[];
}
