#!/usr/bin/env node
/**
 * Fails when a relative target, or an anchor inside a Markdown file, does not
 * resolve.
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
 * Fragments (`#section`, or `file.md#section`) are resolved against the
 * headings of their file, but only when that file is Markdown. `#L340` in a
 * `.ts` link is GitHub's line anchor, not a heading, and a rule that treated
 * every fragment as a slug would fail on it.
 */
const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// A Markdown link, inline (`[text](target "title")`) or a reference definition
// (`[label]: target`). The target stops at whitespace or the closing `)`.
const INLINE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const DEFINITION = /^ {0,3}\[[^\]]+\]:\s*(\S+)/gm;

// Anything with a scheme (`https:`, `mailto:`) or a protocol-relative URL is
// not a path in this repository, so it is not ours to check. A bare `#anchor`
// is no longer skipped here: it is resolved against its own file further down.
const EXTERNAL = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

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

/**
 * The GitHub anchor a heading text produces: lowercase, links reduced to their
 * text, HTML tags and code fences dropped, punctuation removed except `-` and
 * `_`, and spaces turned into hyphens. Accented letters survive, which is why
 * this uses Unicode property classes instead of `[a-z0-9]`.
 */
function slugify(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/`/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\p{M}_ -]/gu, '')
    .replace(/ /g, '-');
}

/**
 * Every heading slug in a Markdown document, in order and with GitHub's
 * `-1`, `-2` suffix for repeated headings. Fenced blocks are dropped whole: a
 * `# comment` inside one is not a heading.
 */
function slugsOf(text) {
  const lines = text.replace(/^```[^\n]*\n[\s\S]*?^```/gm, '').split('\n');
  const seen = new Map();
  const slugs = [];

  const add = (headingText) => {
    const base = slugify(headingText);
    if (!base) return;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    slugs.push(count === 0 ? base : `${base}-${count}`);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const atx = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
    if (atx) {
      add(atx[1]);
      continue;
    }
    // A line underlined with `=` or `-` is a heading; a dash line after a blank
    // line is a horizontal rule, which is why the text line has to be there.
    const underline = /^ {0,3}(?:=+|-+)\s*$/.test(lines[i + 1] ?? '');
    if (underline && line.trim() && !/^ {0,3}(?:[-*+>|#]|\d+\.)/.test(line)) add(line);
  }

  return slugs;
}

/** Explicit anchors, which GitHub honours too: `<a id="x">` or `<a name="x">`. */
function anchorsOfText(text) {
  const found = new Set(slugsOf(text));
  for (const match of text.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/g)) found.add(match[1]);
  return found;
}

const anchorCache = new Map();

function anchorsOf(file) {
  if (!anchorCache.has(file)) {
    anchorCache.set(file, anchorsOfText(readFileSync(path.join(ROOT, file), 'utf8')));
  }
  return anchorCache.get(file);
}

/** Why a fragment fails to resolve, or null when it matches an anchor. */
function anchorProblem(file, fragment) {
  // Only Markdown has headings. `fileSystem.ts#L340` is a line anchor.
  if (!file.endsWith('.md')) return null;

  let wanted;
  try {
    wanted = decodeURIComponent(fragment);
  } catch {
    return 'has an anchor that is not valid percent-encoding';
  }
  if (!wanted) return null;

  const anchors = anchorsOf(file);
  if (anchors.has(wanted)) return null;

  // Anchors are case-sensitive, and a capitalised one is the mistake this can
  // explain instead of only noting that nothing matched.
  const lower = wanted.toLowerCase();
  const hint = anchors.has(lower) ? `; anchors are lowercase, so #${lower}` : '';
  return `does not match any heading or anchor in ${file}${hint}`;
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
  const counts = { links: 0, anchors: 0 };

  for (const { target, line } of targetsOf(code)) {
    if (EXTERNAL.test(target)) continue;

    const hash = target.indexOf('#');
    const fragment = hash >= 0 ? target.slice(hash + 1) : '';
    // `explain.md#section` and `list.html?x=1` are still about the path before
    // the fragment or the query.
    const bare = (hash >= 0 ? target.slice(0, hash) : target).split('?')[0];

    // A pure `#anchor` points at the file it is written in.
    if (!bare) {
      if (!fragment) continue;
      counts.anchors += 1;
      const reason = anchorProblem(file, fragment);
      if (reason) problems.push({ file, line, target, reason });
      continue;
    }

    let decoded;
    try {
      decoded = decodeURIComponent(bare);
    } catch {
      problems.push({ file, line, target, reason: 'is not valid percent-encoding' });
      continue;
    }
    counts.links += 1;

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
      continue;
    }

    if (fragment) {
      counts.anchors += 1;
      const reason = anchorProblem(repoPath, fragment);
      if (reason) problems.push({ file, line, target, reason });
    }
  }

  return { ...counts, problems };
}

function main() {
  // Paths may be passed to check a subset; the default is every tracked file.
  const requested = process.argv.slice(2);
  const files = requested.length > 0 ? requested : git(['ls-files', '-z', '*.md']);
  const tracked = new Set(git(['ls-files', '-z']));

  let links = 0;
  let anchors = 0;
  const problems = [];
  for (const file of files) {
    const result = check(file, tracked);
    links += result.links;
    anchors += result.anchors;
    problems.push(...result.problems);
  }

  // Annotations put each failure next to the line in the CI summary, which is
  // where somebody reading a red run looks first.
  for (const problem of problems) {
    console.error(`::error file=${problem.file},line=${problem.line}::${problem.target} ${problem.reason}`);
  }

  if (problems.length > 0) {
    console.error(
      `\n${problems.length} broken link(s) among ${links} relative targets and ${anchors} anchor(s) in ${files.length} Markdown file(s).`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(`${links} relative link(s) in ${files.length} Markdown file(s), all resolve and are tracked.`);
  console.log(`${anchors} anchor(s) match a heading or an explicit anchor in their file.`);
}

if (require.main === module) {
  main();
}

module.exports = { slugsOf, anchorsOfText, anchorProblem };
