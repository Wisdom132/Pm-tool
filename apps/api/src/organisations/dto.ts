import { IsString, MaxLength, MinLength } from 'class-validator';
import { Trim } from '../common/trim';

export class RenameOrganisationDto {
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}

export class DeleteOrganisationDto {
  /**
   * The organisation's own name, typed back.
   *
   * A confirmation the user has to read rather than a button they can click
   * past — this removes every site, team and connection in the workspace.
   */
  @IsString()
  @MaxLength(120)
  confirm!: string;
}
