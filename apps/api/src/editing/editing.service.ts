import { BadRequestException, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { SitesService } from '../sites/sites.service';
import { AuditRepository } from '../audit/audit.repository';
import { ProvidersService } from '../providers/providers.service';
import { ProviderError, type RepositoryProvider } from '../providers/provider.types';
import { I18nService, type I18nEdit } from './i18n.service';
import { LocateService } from './locate.service';
import { assertSourcePath } from './source-path';
import { resolveRef, type Mode } from './resolve-ref';
import type { CreateChangeRequestDto, CreateIssueDto, EditDto } from './dto';
import { applyEditsToFile } from './codemod/index.js';
import { buildCommitMessage, buildIssueBody, buildPrBody, plural } from './patcher.js';

/** An edit that was not applied, and why — in words the editor can act on. */
export interface Skipped {
  originalText?: string;
  reason: string;
}

/**
 * Turning edits made in a browser into a change request.
 *
 * Ported from `pages/api/create-pr.js`. The pipeline is the same, and the
 * two things that changed are the two that had to:
 *
 *   **The client no longer names the repository.** The old route took
 *   `repo` and `branch` from the request body, which came from a page we do
 *   not control. Any editor could therefore write to any repository their
 *   organisation's connection could reach, regardless of which sites their
 *   team had been granted. Both are now derived from the registered site.
 *
 *   **Writes go through `RepositoryProvider`.** The old route held a GitHub
 *   installation token directly. GitLab and Bitbucket land behind the same
 *   interface without touching this file.
 */
@Injectable()
export class EditingService {
  private readonly logger = new Logger(EditingService.name);

  constructor(
    private readonly sites: SitesService,
    private readonly providers: ProvidersService,
    private readonly i18n: I18nService,
    private readonly locator: LocateService,
    private readonly audit: AuditRepository,
  ) {}

  // ── reads ──────────────────────────────────────────────────────

  /**
   * Read one source file so it can be edited in the browser.
   *
   * The `revision` goes back with the content and is handed in again on
   * commit, where the provider rejects a stale one. That is what stops an
   * in-browser edit from clobbering a push that landed while the panel was
   * open.
   */
  async readFile(userId: string, environmentId: string, path: string, ref?: string) {
    const { provider, ref: resolved } = await this.openFor(userId, environmentId, ref);
    const safe = assertSourcePath(path);

    try {
      const { content, revision } = await provider.readFile(safe, resolved);
      return { content, revision, path: safe, ref: resolved };
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'not-found') {
        throw new BadRequestException(
          `${safe} is not on "${resolved}". The preview may have been built from a different commit.`,
        );
      }
      throw err;
    }
  }

  async listBranches(userId: string, environmentId: string) {
    const { provider } = await this.openFor(userId, environmentId);
    return { branches: await provider.listBranches() };
  }

  async locate(userId: string, environmentId: string, text: string, ref?: string) {
    const { provider, ref: resolved } = await this.openFor(userId, environmentId, ref);
    return this.locator.findCandidates(provider, resolved, text);
  }

  /**
   * How does the commit a preview was built from relate to its branch today?
   *
   * Lets the extension warn before an edit session rather than surfacing
   * the problem only once a change request has been opened.
   */
  async previewStatus(userId: string, environmentId: string, commit: string, branch?: string) {
    const { provider, ref } = await this.openFor(userId, environmentId, branch);
    return provider.compareCommit(commit, ref);
  }

  // ── writes ─────────────────────────────────────────────────────

  /**
   * File the edits as an issue instead of a change request.
   *
   * The escape hatch for pages with no build annotation: rather than
   * guessing at source files, the editor's intent is recorded verbatim for
   * whoever does know where the text lives. A wrong issue costs a moment; a
   * wrong commit costs a revert.
   */
  async createIssue(userId: string, editor: string, dto: CreateIssueDto) {
    const { provider, environment } = await this.openFor(
      userId,
      dto.environmentId,
      undefined,
      'write',
    );

    const issue = await provider.openIssue({
      title: `[Inline Edit] ${hostnameOf(dto.pageUrl)} — ${plural(
        dto.edits.length,
        'suggested change',
      )}`,
      body: buildIssueBody({
        edits: dto.edits,
        editor: { login: editor },
        pageUrl: dto.pageUrl,
        note: dto.note,
      }),
    });

    await this.audit.record({
      organisationId: environment.organisationId,
      actorUserId: userId,
      action: 'issue.opened',
      subject: `${provider.fullName} #${issue.number}`,
      detail: { url: issue.url, hostname: environment.hostname, edits: dto.edits.length },
    });

    this.logger.log(
      `Issue ${provider.fullName}#${issue.number} opened by ${editor} for ${environment.hostname}`,
    );

    return { issueUrl: issue.url, issueNumber: issue.number };
  }

  /**
   * The whole edit pipeline: branch, commit, open a change request.
   *
   * Reports per-edit outcomes rather than all-or-nothing. One unlocatable
   * string used to abort the entire pull request, which meant a single
   * stale line wasted every other change the editor had made.
   */
  async createChangeRequest(userId: string, editor: string, dto: CreateChangeRequestDto) {
    const { provider, environment, ref: baseBranch } = await this.openFor(
      userId,
      dto.environmentId,
      dto.branch,
      'write',
    );

    // Reject no-ops before doing any provider work.
    const realEdits = dto.edits.filter((e) => e.originalText !== e.newText);
    if (realEdits.length === 0) {
      throw new BadRequestException('Every edit is a no-op — the new text matches the old.');
    }

    // Redirect translated copy to its locale file before anything looks at
    // sourceFile: the component holds a t('key') call, not the text.
    const resolved = await this.i18n.resolve(
      provider,
      baseBranch,
      realEdits as unknown as I18nEdit[],
    );

    const skipped: Skipped[] = [];
    const withSource: EditDto[] = [];

    for (const edit of resolved as unknown as (EditDto & { i18nUnresolved?: string })[]) {
      if (edit.i18nUnresolved) {
        skipped.push({ originalText: edit.originalText, reason: edit.i18nUnresolved });
        continue;
      }
      if (!edit.sourceFile) {
        skipped.push({
          originalText: edit.originalText,
          reason: 'No source file for this edit. Use Locate to confirm where it lives.',
        });
        continue;
      }
      // Every path is validated here, before a branch exists. They arrive
      // from a page we do not control and are about to be written with the
      // organisation's credentials — and doing it up front means a bad path
      // cannot leave an orphan branch behind.
      try {
        assertSourcePath(edit.sourceFile);
        if (edit.upload) assertSourcePath(edit.upload.path);
        withSource.push(edit);
      } catch (err) {
        skipped.push({ originalText: edit.originalText, reason: (err as Error).message });
      }
    }

    if (withSource.length === 0) {
      throw new BadRequestException(
        'None of these edits has a usable source file. Annotated pages resolve ' +
          'automatically; otherwise use Locate in the review panel to confirm where ' +
          'each one lives.',
      );
    }

    const branchName = `inline-edit/${Date.now()}-${randomBytes(2).toString('hex')}`;

    // Branch from the exact commit the preview was built from, so the files
    // patched are the ones the editor actually saw, and git's merge base
    // keeps the diff limited to these edits. If the branch was rebased or
    // force-pushed since, that commit is unreachable and the tip is used.
    const staleness = dto.buildCommit
      ? await provider.compareCommit(dto.buildCommit, baseBranch)
      : null;

    const fromRevision =
      staleness?.usable && dto.buildCommit
        ? dto.buildCommit
        : await provider.resolveRef(baseBranch);

    await provider.createBranch(branchName, fromRevision);

    const applied: EditDto[] = [];
    let committedFiles = 0;

    committedFiles += await this.commitUploads(provider, branchName, withSource, skipped);

    const wholeFile = withSource.filter((e) => e.kind === 'file');
    committedFiles += await this.commitWholeFiles(
      provider,
      branchName,
      baseBranch,
      wholeFile,
      applied,
      skipped,
    );

    committedFiles += await this.patchFiles(
      provider,
      branchName,
      dto.pageUrl,
      withSource,
      wholeFile,
      applied,
      skipped,
    );

    // `applied`, not `committedFiles`: an upload can commit on its own,
    // which would open a change request whose table is empty and whose
    // title claims "0 changes". Nothing useful to review.
    if (applied.length === 0) {
      throw new UnprocessableEntityException({
        message:
          'None of the edits could be applied to the source. ' +
          (skipped[0]?.reason ?? 'The files may have changed since the preview was built.'),
        failures: skipped,
      });
    }

    const change = await provider.openChangeRequest({
      title: `[Inline Edit] ${hostnameOf(dto.pageUrl)} — ${plural(applied.length, 'change')}`,
      body: buildPrBody({
        edits: applied,
        skipped,
        editor: { login: editor },
        pageUrl: dto.pageUrl,
        note: dto.note,
        staleness,
      }),
      head: branchName,
      base: baseBranch,
    });

    // Standalone rather than in a transaction: the change request already
    // exists on the provider's side, so failing to record it must not undo
    // anything — and an unrecorded pull request is better than a lost one.
    await this.audit.record({
      organisationId: environment.organisationId,
      actorUserId: userId,
      action: 'pr.opened',
      subject: `${provider.fullName} #${change.number}`,
      detail: {
        url: change.url,
        hostname: environment.hostname,
        branch: branchName,
        base: baseBranch,
        applied: applied.length,
        skipped: skipped.length,
      },
    });

    this.logger.log(
      `Change request ${provider.fullName}#${change.number} opened by ${editor}: ` +
        `${applied.length} applied, ${skipped.length} skipped, ${committedFiles} files, ` +
        `base ${baseBranch}, preview ${staleness?.status ?? 'not reported'}`,
    );

    return {
      changeUrl: change.url,
      changeNumber: change.number,
      branchName,
      staleness,
      applied: applied.length,
      failures: skipped,
      // Kept so the current extension build keeps working; the names above
      // are the provider-neutral ones.
      prUrl: change.url,
      prNumber: change.number,
    };
  }

  // ── the three commit passes ────────────────────────────────────

  /**
   * Uploaded images first: the source change points at these paths, so
   * committing them afterwards would leave the branch briefly broken.
   */
  private async commitUploads(
    provider: RepositoryProvider,
    branch: string,
    edits: EditDto[],
    skipped: Skipped[],
  ): Promise<number> {
    let committed = 0;

    for (const edit of edits) {
      if (!edit.upload?.dataUrl) continue;

      const base64 = String(edit.upload.dataUrl).split(',')[1];
      if (!base64) {
        skipped.push({ originalText: edit.originalText, reason: 'Uploaded image was not readable.' });
        continue;
      }

      // Already validated in the pre-flight pass; re-asserted so this
      // function is safe on its own terms rather than by assumption.
      const path = assertSourcePath(edit.upload.path);

      try {
        await provider.commitBinary({
          path,
          branch,
          base64,
          message: `inline-edit: add ${path}`,
        });
        committed++;
      } catch (err) {
        skipped.push({
          originalText: edit.originalText,
          reason: `Could not commit image: ${(err as Error).message}`,
        });
      }
    }

    return committed;
  }

  /**
   * Whole-file edits from the in-browser code editor replace the file
   * outright and do not go through the codemod — the author is a developer
   * who wrote the result themselves. The revision they read it at is passed
   * through, so the provider rejects the commit if the branch moved
   * underneath them.
   */
  private async commitWholeFiles(
    provider: RepositoryProvider,
    branch: string,
    baseBranch: string,
    wholeFile: EditDto[],
    applied: EditDto[],
    skipped: Skipped[],
  ): Promise<number> {
    let committed = 0;

    for (const edit of wholeFile) {
      try {
        await provider.commitText({
          path: edit.sourceFile!,
          branch,
          content: edit.fileContent ?? '',
          revision: edit.baseRevision,
          message: `inline-edit: edit ${edit.sourceFile}`,
        });
        applied.push({ ...edit });
        committed++;
      } catch (err) {
        const conflict = err instanceof ProviderError && err.code === 'conflict';
        skipped.push({
          originalText: edit.originalText,
          reason: conflict
            ? `${edit.sourceFile} changed on ${baseBranch} while it was open. Re-open it and redo the change.`
            : `Could not commit ${edit.sourceFile}: ${(err as Error).message}`,
        });
      }
    }

    return committed;
  }

  /** Everything else: one codemod pass per file. */
  private async patchFiles(
    provider: RepositoryProvider,
    branch: string,
    pageUrl: string,
    withSource: EditDto[],
    wholeFile: EditDto[],
    applied: EditDto[],
    skipped: Skipped[],
  ): Promise<number> {
    const byFile = new Map<string, EditDto[]>();
    for (const edit of withSource) {
      if (edit.kind === 'file') continue;
      const list = byFile.get(edit.sourceFile!) ?? [];
      list.push(edit);
      byFile.set(edit.sourceFile!, list);
    }

    // A file cannot be both hand-edited and patched in one change request —
    // the codemod would be working from content the author has replaced.
    for (const edit of wholeFile) {
      const conflicting = byFile.get(edit.sourceFile!);
      if (!conflicting) continue;

      for (const other of conflicting) {
        skipped.push({
          originalText: other.originalText,
          reason: `${edit.sourceFile} was edited directly, so this change was not applied on top of it.`,
        });
      }
      byFile.delete(edit.sourceFile!);
    }

    let committed = 0;

    for (const [filePath, edits] of byFile) {
      let original: string;
      let revision: string;
      try {
        ({ content: original, revision } = await provider.readFile(filePath, branch));
      } catch (err) {
        for (const edit of edits) {
          skipped.push({
            originalText: edit.originalText,
            reason: `Could not read ${filePath}: ${(err as Error).message}`,
          });
        }
        continue;
      }

      // One pass per file: the codemod resolves every edit against a single
      // parse and reports each one individually, so an unlocatable string
      // no longer aborts the whole change request.
      const result = applyEditsToFile({ content: original, filePath, edits });

      for (const failure of result.failed) {
        skipped.push({ originalText: failure.edit?.originalText, reason: failure.reason });
      }

      if (result.applied.length === 0) {
        this.logger.warn(`No edit applied to ${filePath} (${result.failed.length} failed)`);
        continue;
      }

      applied.push(...result.applied);

      await provider.commitText({
        path: filePath,
        branch,
        content: result.content,
        revision,
        message: buildCommitMessage(result.applied, pageUrl),
      });
      committed++;
    }

    return committed;
  }

  // ── shared setup ───────────────────────────────────────────────

  /**
   * Authorise the caller, then open the repository their site points at.
   *
   * Every editing endpoint starts here. `ref` is only honoured when the
   * environment has no branch of its own — the preview-deploy case, where
   * the branch genuinely is per-deployment. Otherwise a client could edit a
   * branch the site was never pointed at.
   */
  private async openFor(
    userId: string,
    environmentId: string,
    ref?: string,
    mode: Mode = 'read',
  ) {
    const { environment } = await this.sites.authoriseEnvironment(userId, environmentId);

    // The asymmetry between reads and writes is the point, and it is
    // explained and tested in resolve-ref.ts.
    const resolved = resolveRef({
      mode,
      environmentBranch: environment.branch,
      requested: ref,
    });

    if (!resolved) {
      throw new BadRequestException(
        `${environment.hostname} takes its branch from the page, but none was sent.`,
      );
    }

    const provider = await this.providers.open(
      environment.organisationId,
      environment.connectionId,
      environment.repository,
    );

    return { provider, environment, ref: resolved };
  }
}

/** A malformed pageUrl should not be what fails an otherwise good edit. */
function hostnameOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).hostname;
  } catch {
    return 'this page';
  }
}
