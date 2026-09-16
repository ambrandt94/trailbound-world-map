#!/usr/bin/env node
/**
 * Commit, push, and deploy GitHub Pages in one step.
 *
 *   npm run ship -- "Commit message here."
 *
 * Pushing `main` triggers `.github/workflows/deploy-pages.yml`.
 * Other branches only push. Redeploy current `main` with no local
 * changes: the script dispatches that workflow.
 */
import { spawnSync } from 'node:child_process';

const PAGES = 'https://ambrandt94.github.io/trailbound-world-map/';
const WORKFLOW = 'deploy-pages.yml';

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    ...opts,
  });
  if (result.status) {
    if (opts.capture && result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status);
  }
  return (result.stdout ?? '').trim();
}

function out(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  if (result.status) {
    const err = (result.stderr || result.stdout || `${cmd} failed`).trim();
    throw new Error(err);
  }
  return (result.stdout ?? '').trim();
}

function hasGh() {
  return spawnSync('gh', ['--version'], { encoding: 'utf8' }).status === 0;
}

function latestRunId() {
  if (!hasGh()) return '';
  const result = spawnSync(
    'gh',
    ['run', 'list', '--workflow', WORKFLOW, '--limit', '1', '--json', 'databaseId', '--jq', '.[0].databaseId'],
    { encoding: 'utf8' },
  );
  return result.status === 0 ? (result.stdout ?? '').trim() : '';
}

function waitForNewRun(previousId) {
  if (!hasGh()) return '';
  for (let i = 0; i < 24; i++) {
    const id = latestRunId();
    if (id && id !== previousId) return id;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500);
  }
  return latestRunId();
}

const message = process.argv.slice(2).join(' ').trim();
const branch = out('git', ['branch', '--show-current']);
if (!branch) {
  console.error('Not on a branch (detached HEAD).');
  process.exit(1);
}

const beforeRun = branch === 'main' ? latestRunId() : '';

const dirty = out('git', ['status', '--porcelain']);
if (dirty) {
  if (!message) {
    console.error('Usage: npm run ship -- "Commit message"');
    console.error('Working tree has changes; pass a commit message.');
    process.exit(1);
  }
  const blocked = dirty
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter((f) => /(^|\/)\.env($|\.)|credentials\.json$|secrets?\./i.test(f));
  if (blocked.length) {
    console.error(`Refusing to commit secret-like files: ${blocked.join(', ')}`);
    process.exit(1);
  }
  run('git', ['add', '-A']);
  run('git', ['commit', '-m', message]);
} else if (message) {
  console.log('Working tree clean; nothing to commit.');
}

const tracking = spawnSync('git', ['rev-parse', '--abbrev-ref', '@{u}'], { encoding: 'utf8' });
let needsPush = true;
if (tracking.status === 0) {
  needsPush = Number(out('git', ['rev-list', '--count', '@{u}..HEAD'])) > 0;
}

if (needsPush) {
  run('git', ['push', '-u', 'origin', 'HEAD']);
} else {
  console.log(`Already up to date with origin/${branch}.`);
  if (branch === 'main') {
    if (!hasGh()) {
      console.error('Install GitHub CLI (gh) to dispatch a Pages deploy without a new commit.');
      process.exit(1);
    }
    console.log(`Dispatching ${WORKFLOW}…`);
    run('gh', ['workflow', 'run', WORKFLOW, '--ref', 'main']);
  }
}

if (branch === 'main') {
  console.log(`Pages: ${PAGES}`);
  if (hasGh()) {
    const id = waitForNewRun(beforeRun);
    if (id) {
      console.log(`Watching workflow ${id}…`);
      run('gh', ['run', 'watch', id, '--exit-status']);
      const url = run('gh', ['run', 'view', id, '--json', 'url', '--jq', '.url'], { capture: true });
      if (url) console.log(url);
    } else {
      console.log('No workflow run found yet. Check the Actions tab.');
    }
  } else {
    console.log('Push started the Pages workflow. Install gh to wait on it here.');
  }
} else {
  console.log(`Pushed ${branch}. Merge to main to deploy Pages.`);
}
