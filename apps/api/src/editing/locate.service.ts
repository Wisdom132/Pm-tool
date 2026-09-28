import { Injectable, Logger } from '@nestjs/common';
import { ProviderError, type RepositoryProvider } from '../providers/provider.types';
import { findLine, MIN_SEARCH_LENGTH, rankCandidates } from './locate-ranking.js';

export interface Candidate {
  sourceFile: string;
  sourceLine: number;
  snippet: string;
}

export interface LocateResult {
  candidates: Candidate[];
  /** Why there are none, in words the editor can act on. */
  reason: string | null;
}

/**
 * Find candidate source files for text that carries no build annotation.
 *
 * Ported from `lib/locate-source.js`, with the Octokit client replaced by
 * `provider.searchText`. The ranking half moved to `locate-ranking.js`,
 * where it is unit-tested.
 *
 * This deliberately decides nothing. Candidates go back to the editor, who
 * confirms one; the alternative — picking the best match and committing to
 * it — is how an edit silently lands in the wrong file.
 */
@Injectable()
export class LocateService {
  private readonly logger = new Logger(LocateService.name);

  async findCandidates(
    provider: RepositoryProvider,
    ref: string,
    text: string,
  ): Promise<LocateResult> {
    const needle = text.trim();

    if (needle.length < MIN_SEARCH_LENGTH) {
      return {
        candidates: [],
        reason:
          `"${needle}" is too short to search for reliably. ` +
          'Install the annotation plugin, or edit this text in the source.',
      };
    }

    let paths: string[];
    try {
      const hits = await provider.searchText(needle);
      paths = hits.map((h) => h.path);
    } catch (err) {
      // Search is the one operation that is routinely unavailable on a
      // perfectly healthy repository — very new and very large ones are not
      // always indexed — so this is a reason, not a failure.
      this.logger.warn(`Search failed for ${provider.fullName}: ${(err as Error).message}`);
      return {
        candidates: [],
        reason:
          err instanceof ProviderError
            ? err.message
            : `Code search could not be reached for ${provider.fullName}.`,
      };
    }

    const ranked = rankCandidates(paths);

    if (ranked.length === 0) {
      return {
        candidates: [],
        reason:
          `No source file in ${provider.fullName} contains this text. ` +
          'It may be generated at runtime, or come from a CMS.',
      };
    }

    // Resolve exact line numbers against the ref being edited. Search is
    // indexed on the default branch and can disagree with it, so a line
    // number taken from the index would be wrong on a feature branch.
    const candidates: Candidate[] = [];
    for (const path of ranked) {
      try {
        const { content } = await provider.readFile(path, ref);
        const line = findLine(content, needle);
        if (line === null) continue;

        candidates.push({
          sourceFile: path,
          sourceLine: line,
          snippet: content.split('\n')[line - 1].trim().slice(0, 160),
        });
      } catch {
        // Not present on this ref — simply not a candidate.
      }
    }

    return {
      candidates,
      reason: candidates.length
        ? null
        : `This text is in ${provider.fullName} but not on the branch being edited. ` +
          'The preview may have been built from a different commit.',
    };
  }
}
