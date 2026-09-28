import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * An image the editor dropped onto the page.
 *
 * Bounded, and validated as a nested object. Declaring it as a bare
 * `@IsOptional()` field — which is what this replaced — lets the whole
 * object through unexamined, because `whitelist` only strips properties
 * that carry no decorator at all. A `dataUrl` with no length limit is a
 * request body of any size the client cares to send.
 */
export class UploadDto {
  @IsString()
  @MaxLength(400)
  path!: string;

  /**
   * `data:image/png;base64,...`
   *
   * 8 MB of base64 is roughly 6 MB of image, which is generous for
   * something going on a web page and small enough to hold in memory.
   */
  @IsString()
  @MaxLength(8_000_000)
  dataUrl!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  size?: number;
}

/**
 * One edit, as the extension sends it.
 *
 * `environmentId` is *not* on this type, and no request carries a repository
 * or branch. That is the central change from the old service, where the
 * extension named `repo` and `branch` in the body: those came from a page we
 * do not control, and trusting them let any editor write to any repository
 * their organisation's connection could reach — bypassing the team-based
 * site access the dashboard sets up. The server now resolves both from the
 * registered site.
 */
export class EditDto {
  /** Repository-relative path. Validated again server-side before use. */
  @IsOptional()
  @IsString()
  @MaxLength(400)
  sourceFile?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  sourceLine?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sourceColumn?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  originalText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  newText?: string;

  /** `text`, `attribute`, `file`, or a structural op. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  kind?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  op?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  attribute?: string;

  /** Set when the element renders through a translation function. */
  @IsOptional()
  @IsString()
  @MaxLength(400)
  i18nKey?: string;

  /** Whole-file edits from the in-browser code editor. */
  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  fileContent?: string;

  /** The revision the file was read at, so a stale write is rejected. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  baseRevision?: string;

  /** True when a human confirmed a located file rather than an annotation. */
  @IsOptional()
  @IsBoolean()
  sourceFileConfirmed?: boolean;

  @IsOptional()
  @IsBoolean()
  locatedBySearch?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => UploadDto)
  upload?: UploadDto;
}

class EditRequestBase {
  /** Which registered site environment this page belongs to, from /resolve. */
  @IsUUID()
  environmentId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => EditDto)
  edits!: EditDto[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  pageUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;
}

export class CreateChangeRequestDto extends EditRequestBase {
  /**
   * The commit the preview was built from, when the page carries one.
   *
   * Branching from it means the diff contains only these edits. Without it
   * the branch tip is used, which can include unrelated work.
   */
  @IsOptional()
  @Matches(/^[0-9a-f]{7,40}$/i, { message: 'buildCommit must be a commit SHA' })
  buildCommit?: string;

  /**
   * Only honoured when the environment's own branch is null — the preview
   * -deploy case, where the branch is per-deployment and genuinely comes
   * from the page.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  branch?: string;
}

export class CreateIssueDto extends EditRequestBase {}

export class ReadFileQueryDto {
  @IsUUID()
  environmentId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  path!: string;

  /** A branch, tag or commit. Defaults to the environment's branch. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  ref?: string;
}

export class LocateDto {
  @IsUUID()
  environmentId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  text!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  ref?: string;
}

export class BranchesQueryDto {
  @IsUUID()
  environmentId!: string;
}

export class PreviewStatusQueryDto {
  @IsUUID()
  environmentId!: string;

  @Matches(/^[0-9a-f]{7,40}$/i, { message: 'commit must be a commit SHA' })
  commit!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  branch?: string;
}
