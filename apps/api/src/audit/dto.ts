import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min, MaxLength } from 'class-validator';

export class AuditQueryDto {
  /** The `nextCursor` from the previous page. */
  @IsOptional()
  @Matches(/^\d{1,19}$/, { message: 'cursor must be a row id' })
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  action?: string;
}
