#!/usr/bin/env node
/**
 * Fails when a relative target in the tracked Markdown does not resolve.
 *
 * The audits moved into `docs/audits/` and every link that pointed at the
 * repository root had to be rewritten by hand, with nothing checking the
 * result. A link is checked twice on purpose: the file has to exist *and* be in
 * the Git index. A link to a file that only exists on the machine that wrote it
 * resolves for its author and 404s for everyone who clones the repository.
 *
 * Matching the index exactly is also what catches the other half of this on
 * Windows: the filesystem ignores case and GitHub does not, so a link written
 * as `readme.md` opens locally and breaks in the browser.
 *
 * Only the target is checked. A `#fragment` inside another file is not resolved
 * against that file's headings: a heading slug is not a filename, and a rule
 * for it would be a second, subtler checker that fails on files it should not.
 */
const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// A Markdown link, inline (`[text](target "title")`) or a reference definition
// (`[label]: target`). The target stops at whitespace or the closing `)`.
const INLINE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const DEFINITION = /^ {0,3}\[[^\]]+\]:\s*(\S+)/gm;

// Anything with a scheme (`https:`, `mailto:`), a protocol-relative URL or a
// bare anchor is not a path in this repository, so it is not ours to check.
const EXTERNAL = /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i;

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
}

/**
 * Blanks out fenced blocks and inline code spans, keeping every newline so the
 * line numbers of the links that remain still point at the right line. A path
 * inside a code span is an example, not a link.
 */
function withoutCode(text) {
  return text
    .replace(/^```[^\n]*\n[\s\S]*?^```/gm, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/`[^`\n]*`/g, (span) => ' '.repeat(span.length));
}

function targetsOf(text) {
  const found = [];
  for (const regex of [INLINE, DEFINITION]) {
    for (const match of text.matchAll(regex)) {
      const line = text.slice(0, match.index).split('\n').length;
      found.push({ target: match[1], line });
    }
  }
  return found;
}

function check(file, tracked) {
  const text = readFileSync(path.join(ROOT, file), 'utf8');
  const code = withoutCode(text);
  const problems = [];
  let links = 0;

  for (const { target, line } of targetsOf(code)) {
    if (EXTERNAL.test(target)) continue;

    // `explain.md#section` and `list.html?x=1` are still about the path before
    // the fragment or the query.
    const bare = target.split('#')[0].split('?')[0];
    if (!bare) continue;

    let decoded;
    try {
      decoded = decodeURIComponent(bare);
    } catch {
      problems.push({ file, line, target, reason: 'is not valid percent-encoding' });
      continue;
    }
    links += 1;

    const absolute = decoded.startsWith('/')
      ? path.join(ROOT, decoded)
      : path.resolve(ROOT, path.dirname(file), decoded);
    const relative = path.relative(ROOT, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      problems.push({ file, line, target, reason: 'points outside the repository' });
      continue;
    }

    const repoPath = relative.split(path.sep).join('/');
    if (!existsSync(absolute)) {
      problems.push({ file, line, target, reason: `does not exist (${repoPath})` });
      continue;
    }
    // A directory is in the index only through the files it holds.
    const inIndex = tracked.has(repoPath) || [...tracked].some((entry) => entry.startsWith(`${repoPath}/`));
    if (!inIndex) {
      problems.push({
        file,
        line,
        target,
        reason: `is not in the git index (${repoPath}), so it would 404 in a clone`,
      });
    }
  }

  return { links, problems };
}

function main() {
  // Paths may be passed to check a subset; the default is every tracked file.
  const requested = process.argv.slice(2);
  const files = requested.length > 0 ? requested : git(['ls-files', '-z', '*.md']);
  const tracked = new Set(git(['ls-files', '-z']));

  let links = 0;
  const problems = [];
  for (const file of files) {
    const result = check(file, tracked);
    links += result.links;
    problems.push(...result.problems);
  }

  // Annotations put each failure next to the line in the CI summary, which is
  // where somebody reading a red run looks first.
  for (const problem of problems) {
    console.error(`::error file=${problem.file},line=${problem.line}::${problem.target} ${problem.reason}`);
  }

  if (problems.length > 0) {
    console.error(
      `\n${problems.length} broken link(s) among ${links} relative targets in ${files.length} Markdown file(s).`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`${links} relative link(s) in ${files.length} Markdown file(s), all resolve and are tracked.`);
}

main();
