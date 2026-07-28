#!/usr/bin/env node
//
// The lint gate for CI: `eslint .` with a ratchet instead of a threshold.
//
// A plain `eslint .` cannot be a gate here, because `src/` carries ~80
// pre-existing problems (React hooks/refresh, unused vars) that predate any
// intent to fix them, and a `--max-warnings N` style cap is the wrong shape for
// them: it lets a brand-new error in one file hide behind somebody else's fix in
// another. So this records the known problems per file *and per rule* in
// .eslint-baseline.json and fails only on a count that went UP.
//
// Consequences worth knowing before you touch this:
//   - A file with no baseline entry must be clean. That is what keeps the
//     Node-side (server/, scripts/, *.cjs, root configs) at zero without a
//     second list of "strict" paths to maintain — those files simply aren't in
//     the baseline, so any problem in them is a regression.
//   - Fixing a problem does not fail the build, it prints a notice. Refresh the
//     baseline with `npm run lint:baseline` to lock the improvement in, or the
//     next equivalent problem in that file will still be allowed.
//   - Because counts are per (file, rule), swapping one violation of a rule for
//     another violation of that same rule inside the same file is invisible.
//     That is the one gap left, and it is deliberate — the alternative is
//     baselining line numbers, which churn on every edit.
//
// Usage:
//   node scripts/lint-baseline.mjs             # the gate (npm run lint:ci)
//   node scripts/lint-baseline.mjs --update    # rewrite the baseline

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = resolve(repoRoot, '.eslint-baseline.json');
const update = process.argv.includes('--update');

// Parse errors and "unused eslint-disable directive" messages carry no ruleId,
// but they are still problems that must not multiply, so they get a bucket.
const NO_RULE = '(no-rule)';

const posix = (p) => relative(repoRoot, p).split(sep).join('/');

const eslint = new ESLint({ cwd: repoRoot });
const results = await eslint.lintFiles(['.']);

/** @type {Record<string, Record<string, number>>} */
const current = {};
/** @type {Map<string, import('eslint').Linter.LintMessage[]>} */
const messagesByFile = new Map();

for (const result of results) {
  if (result.messages.length === 0) continue;
  const file = posix(result.filePath);
  messagesByFile.set(file, result.messages);
  const counts = (current[file] ??= {});
  for (const message of result.messages) {
    const rule = message.ruleId ?? NO_RULE;
    counts[rule] = (counts[rule] ?? 0) + 1;
  }
}

const sortDeep = (map) => Object.fromEntries(
  Object.keys(map).sort().map((file) => [
    file,
    Object.fromEntries(Object.keys(map[file]).sort().map((rule) => [rule, map[file][rule]])),
  ]),
);

const total = (map) => Object.values(map)
  .reduce((sum, rules) => sum + Object.values(rules).reduce((a, b) => a + b, 0), 0);

if (update) {
  writeFileSync(baselinePath, `${JSON.stringify({
    note: 'Pre-existing eslint problems, per file and rule. Managed by scripts/lint-baseline.mjs — do not hand-edit. A file absent from `files` must lint clean.',
    files: sortDeep(current),
  }, null, 2)}\n`);
  console.log(`Wrote ${posix(baselinePath)}: ${total(current)} problems across ${Object.keys(current).length} files.`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).files ?? {};
} catch (err) {
  console.error(`Cannot read ${posix(baselinePath)}: ${err.message}`);
  console.error('Create it with: npm run lint:baseline');
  process.exit(1);
}

const files = [...new Set([...Object.keys(baseline), ...Object.keys(current)])].sort();
const violations = [];
const improvements = [];

for (const file of files) {
  const was = baseline[file] ?? {};
  const now = current[file] ?? {};
  for (const rule of [...new Set([...Object.keys(was), ...Object.keys(now)])].sort()) {
    const before = was[rule] ?? 0;
    const after = now[rule] ?? 0;
    if (after > before) violations.push({ file, rule, before, after });
    else if (after < before) improvements.push({ file, rule, before, after });
  }
}

for (const { file, rule, before, after } of violations) {
  console.error(`\n${file}: ${rule} — ${before} allowed, ${after} found`);
  for (const message of messagesByFile.get(file) ?? []) {
    if ((message.ruleId ?? NO_RULE) !== rule) continue;
    console.error(`  ${file}:${message.line}:${message.column}  ${message.message}`);
  }
}

const baselineTotal = total(baseline);
const currentTotal = total(current);

if (violations.length > 0) {
  console.error(`\n${violations.length} lint regression(s). Total problems ${baselineTotal} -> ${currentTotal}.`);
  console.error('Fix them, or — only if the problem is genuinely pre-existing and being');
  console.error('carried forward on purpose — record it with: npm run lint:baseline');
  process.exit(1);
}

console.log(`Lint gate passed: ${currentTotal} problem(s), none new (baseline ${baselineTotal}).`);

if (improvements.length > 0) {
  const fixed = improvements.reduce((sum, i) => sum + (i.before - i.after), 0);
  console.log(`\n${fixed} recorded problem(s) are gone:`);
  for (const { file, rule, before, after } of improvements) {
    console.log(`  ${file}: ${rule} ${before} -> ${after}`);
  }
  console.log('Lock that in with: npm run lint:baseline');
}
