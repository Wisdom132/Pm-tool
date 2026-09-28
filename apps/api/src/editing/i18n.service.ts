import { Injectable, Logger } from '@nestjs/common';
import { ProviderError, type RepositoryProvider } from '../providers/provider.types';
import { rankLocaleFiles, readKey } from './codemod/locale.js';

export interface I18nEdit {
  i18nKey?: string;
  sourceFile?: string;
  sourceLine?: number;
  /** Set when the key could not be found; the edit is skipped, not guessed. */
  i18nUnresolved?: string;
  i18nFile?: boolean;
  [key: string]: unknown;
}

/**
 * Point i18n edits at the locale file that actually holds their text.
 *
 * The annotation plugin stamps `data-edit-i18n-key` on elements rendered
 * through a translation function. The component holds a `t('key')` call and
 * no literal, so the edit has to be redirected to the source-locale JSON
 * before any codemod looks at `sourceFile`.
 *
 * Ported from `lib/resolve-i18n.js`. The only change is the transport: it
 * reads through `RepositoryProvider` instead of a GitHub token, which is
 * what lets the same code serve GitLab later.
 */
@Injectable()
export class I18nService {
  private readonly logger = new Logger(I18nService.name);

  /**
   * @returns the edits, with each i18n one repointed at its locale file, or
   *          carrying `i18nUnresolved` when its key is nowhere to be found.
   *          Never guesses: an unresolved key surfaces as skipped rather
   *          than being written into a plausible-looking file.
   */
  async resolve(
    provider: RepositoryProvider,
    ref: string,
    edits: I18nEdit[],
  ): Promise<I18nEdit[]> {
    if (!edits.some((e) => e.i18nKey)) return edits;

    let candidates: string[];
    try {
      candidates = rankLocaleFiles(await provider.listPaths(ref));
    } catch (err) {
      // A tree we cannot read is not a reason to fail the whole request —
      // the non-i18n edits in it are still perfectly applicable.
      this.logger.warn(
        `Could not list ${provider.fullName} at ${ref}: ${(err as Error).message}`,
      );
      return edits;
    }

    if (candidates.length === 0) {
      this.logger.warn(`No locale files in ${provider.fullName}`);
      return edits.map((e) =>
        e.i18nKey
          ? { ...e, i18nUnresolved: 'No locale files were found in this repository.' }
          : e,
      );
    }

    // Parse each candidate once, then answer every key from the cache. The
    // old version did the same; it matters because a repository with ten
    // locales and thirty edits would otherwise be three hundred reads.
    const parsed = new Map<string, unknown>();
    for (const path of candidates) {
      try {
        const { content } = await provider.readFile(path, ref);
        parsed.set(path, JSON.parse(content));
      } catch (err) {
        // Unreadable or malformed JSON — simply not a candidate. A provider
        // outage is worth a line; a missing file is not.
        if (err instanceof ProviderError && err.code !== 'not-found') {
          this.logger.warn(`Could not read ${path}: ${err.message}`);
        }
      }
    }

    return edits.map((edit) => {
      if (!edit.i18nKey) return edit;

      const match = candidates.find(
        (path) => parsed.has(path) && typeof readKey(parsed.get(path), edit.i18nKey) === 'string',
      );

      if (!match) {
        return {
          ...edit,
          i18nUnresolved: `Translation key "${edit.i18nKey}" was not found in any locale file.`,
        };
      }

      // sourceLine is dropped deliberately: a locale edit is keyed, not
      // positioned, and a line number carried over from the component would
      // point at an unrelated line of JSON.
      return { ...edit, sourceFile: match, sourceLine: undefined, i18nFile: true };
    });
  }
}
