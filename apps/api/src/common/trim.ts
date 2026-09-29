import { Transform } from 'class-transformer';

/**
 * Trim a string field *before* it is validated.
 *
 * The bug this exists to prevent: `@IsNotEmpty()` on a raw value accepts
 * `"   "`, and then the service trims it on the way to the database and
 * stores `""`. Validation checked one value and the write used another.
 *
 * Seen twice — a feedback comment that arrived blank, and a site whose
 * repository was the empty string and so failed on every edit rather than at
 * registration. Both were accepted with a 201.
 *
 * Applying it here rather than guarding in each service means the DTO is the
 * single description of what is acceptable, and a new field cannot forget.
 */
export const Trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
