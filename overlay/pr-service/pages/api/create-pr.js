import { verifyExtensionToken } from '../../lib/withAuth.js';
import {
  createBranch,
  getBranchSha,
  compareBuildCommit,
  getFileContent,
  commitFileChange,
  openPullRequest,
} from '../../lib/github.js';
import { buildCommitMessage, buildPrBody } from '../../lib/patcher.js';
import { applyEditsToFile } from '../../lib/codemod/index.js';
import { resolveI18nEdits } from '../../lib/resolve-i18n.js';
import { log } from '../../lib/logger.js';
import { initObservability } from '../../lib/observability.js';
import { getWriteToken } from '../../lib/github-app.js';
import { enforce, LIMITS } from '../../lib/rate-limit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  await initObservability();

  const auth = await verifyExtensionToken(req, res);
  if (!auth) return;

  if (!(await enforce(res, 'create-pr', auth.userId, LIMITS.createPr))) return;

  const { repo, branch: baseBranch, edits, pageUrl, note, buildCommit } = req.body;

  if (!repo || !repo.includes('/'))
    return res.status(400).json({ error: '`repo` must be "owner/name"' });
  if (!baseBranch)
    return res.status(400).json({ error: '`branch` is required' });
  if (!Array.isArray(edits) || edits.length === 0)
    return res.status(400).json({ error: '`edits` array is required' });
  if (!pageUrl)
    return res.status(400).json({ error: '`pageUrl` is required' });
  if (buildCommit && !/^[0-9a-f]{7,40}$/i.test(buildCommit))
    return res.status(400).json({ error: '`buildCommit` must be a commit SHA' });

  const [owner, repoName] = repo.split('/');
  const { login } = auth;

  // Every write goes through an installation token, so an editor with only
  // read access to the repository can still open a pull request. The user's
  // own token is kept for reads and for attribution.
  let writeToken;
  try {
    writeToken = await getWriteToken({ owner, repo: repoName });
  } catch (err) {
    log.warn('create_pr.no_installation', { login, repo, error: err.message });
    return res.status(403).json({ error: err.message });
  }

  // Per-installation limit on top of the per-user one, so one noisy user
  // cannot exhaust a whole organisation's budget.
  if (!(await enforce(res, 'create-pr-repo', repo, LIMITS.createPr))) return;

  // Reject no-ops
  const realEdits = edits.filter((e) => e.originalText !== e.newText);
  if (realEdits.length === 0)
    return res.status(400).json({ error: 'All edits are no-ops (original === new text)' });

  // Edits arrive already resolved: either annotated at build time, or
  // located via /api/locate and confirmed by the editor. Nothing is guessed
  // here — an unresolved edit is reported, never written somewhere plausible.
  const resolvedEdits = realEdits.map((edit) =>
    edit.sourceFile && !edit.sourceFileConfirmed && edit._locatedBySearch
      ? { ...edit, _foundViaSearch: true }
      : edit
  );

  log.debug('create_pr.edits_resolved', {
    login,
    repo,
    edits: resolvedEdits.map((e) => ({
      sourceFile: e.sourceFile || null,
      sourceLine: e.sourceLine || null,
      foundViaSearch: e._foundViaSearch || false,
    })),
  });

  // Redirect translated copy to its locale file before anything else looks
  // at sourceFile — the component holds a t('key') call, not the text.
  const i18nResolved = await resolveI18nEdits({
    token: writeToken, owner, repo: repoName, branch: baseBranch, edits: resolvedEdits,
  });

  const withSource = i18nResolved.filter((e) => e.sourceFile && !e._i18nUnresolved);
  if (withSource.length === 0)
    return res.status(400).json({
      error:
        'None of these edits has a source file. Annotated pages resolve automatically; otherwise use Locate in the review panel to confirm where each one lives.',
    });

  try {
    const ts         = Date.now();
    const suffix     = Math.random().toString(36).slice(2, 6);
    const branchName = `inline-edit/${ts}-${suffix}`;

    // Branch from the exact commit the preview was built from, so the files we
    // patch are the ones the editor actually saw. Git's merge base keeps the
    // resulting PR diff limited to these edits. If the branch was rebased or
    // force-pushed since the build, that commit is no longer reachable and we
    // fall back to the branch tip.
    let staleness = null;
    if (buildCommit) {
      try {
        staleness = await compareBuildCommit({
          token: writeToken, owner, repo: repoName, buildCommit, branch: baseBranch,
        });
      } catch (err) {
        // Unknown commit (shallow clone, deleted history) — treat as unusable.
        log.warn('create_pr.compare_failed', { repo, buildCommit, error: err.message });
      }
    }

    const fromSha = staleness?.usable
      ? buildCommit
      : await getBranchSha({ token: writeToken, owner, repo: repoName, branch: baseBranch });

    await createBranch({ token: writeToken, owner, repo: repoName, branchName, fromSha });

    // Group edits by file
    const byFile = {};
    for (const edit of withSource) {
      (byFile[edit.sourceFile] = byFile[edit.sourceFile] || []).push(edit);
    }

    const failures = [];
    const allApplied = [];
    let committedFiles = 0;

    for (const [filePath, fileEdits] of Object.entries(byFile)) {
      const { content: original, sha } = await getFileContent({
        token: writeToken, owner, repo: repoName, path: filePath, branch: branchName,
      });

      // One pass per file: the codemod resolves every edit against a single
      // parse and reports each one individually, so an unlocatable string no
      // longer aborts the whole pull request.
      const { content, applied, failed } = applyEditsToFile({
        content: original,
        filePath,
        edits: fileEdits,
      });

      for (const f of failed) failures.push({ ...f.edit, reason: f.reason });

      if (applied.length === 0) {
        log.warn('create_pr.file_unchanged', { repo, filePath, failed: failed.length });
        continue;
      }

      allApplied.push(...applied);

      const message = buildCommitMessage(applied, pageUrl);
      await commitFileChange({
        token: writeToken, owner, repo: repoName,
        path: filePath, branch: branchName, content, sha, message,
      });
      committedFiles++;
    }

    if (committedFiles === 0) {
      return res.status(422).json({
        error:
          'None of the edits could be applied to the source. ' +
          (failures[0]?.reason || 'The files may have changed since the preview was built.'),
        failures: failures.map((f) => ({ originalText: f.originalText, reason: f.reason })),
      });
    }

    const skipped = [
      ...i18nResolved
        .filter((e) => !e.sourceFile || e._i18nUnresolved)
        .map((e) => (e._i18nUnresolved ? { ...e, reason: e._i18nUnresolved } : e)),
      ...failures,
    ];
    const body  = buildPrBody({ edits: allApplied, skipped, editor: { login }, pageUrl, note, staleness });
    const title = `[Inline Edit] ${new URL(pageUrl).hostname} — ${allApplied.length} change${allApplied.length > 1 ? 's' : ''}`;

    const { prUrl, prNumber } = await openPullRequest({
      token: writeToken, owner, repo: repoName,
      title, body,
      head: branchName,
      base: baseBranch,
    });

    log.info('create_pr.opened', {
      login, repo, prNumber, branchName, baseBranch,
      files: committedFiles,
      applied: allApplied.length,
      skipped: skipped.length,
      failures: failures.length,
      buildCommit: buildCommit || null,
      previewStatus: staleness?.status || null,
    });

    res.json({
      prUrl,
      prNumber,
      branchName,
      staleness,
      applied: allApplied.length,
      failures: failures.map((f) => ({ originalText: f.originalText, reason: f.reason })),
    });
  } catch (err) {
    log.error('create_pr.failed', { login, repo, baseBranch, error: err.message });
    res.status(500).json({ error: err.message });
  }
}
