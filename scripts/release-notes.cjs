#!/usr/bin/env node
/**
 * Writes the body of a GitHub release from the commits that went into it.
 *
 * The 1.0.49 release shipped with an empty body: the publish step created the
 * release from the artifacts alone, so the tag itself was the only description
 * of what changed. Nothing in the repository asked for a body, so nothing
 * supplied one.
 *
 * This reads the commits between the previous tag and this one and groups them
 * by the conventional type their subject already carries, which is the only
 * classification the history promises. Subjects stay verbatim: they are the
 * record the repository already keeps, and rewriting them here would add a
 * second description of the same change that could drift from the first.
 */
const { execFileSync } = require('node:child_process');

const SECTIONS = [
  { title: 'Nuevas funciones', types: ['feat'] },
  { title: 'Correcciones', types: ['fix'] },
  { title: 'Rendimiento', types: ['perf'] },
  { title: 'Mantenimiento', types: ['refactor', 'test', 'docs', 'ci', 'build', 'style', 'chore'] },
];

// A subject that is not conventional is still a commit somebody made, and
// dropping it would make the body quietly incomplete.
const OTHER_TITLE = 'Mantenimiento';

const SUBJECT = /^([a-z]+)(?:\(([^)]+)\))?!?: /;

/** The version bump is the release itself, not a change worth announcing. */
const isVersionCut = (type, scope) => type === 'chore' && scope === 'release';

/**
 * Reads `%H%x1f%s%x1f%b%x1e` records. Merge commits are left out: a merge says
 * how the history was assembled, not what changed, and this repository pushes
 * to master without them.
 */
function parseCommits(output) {
  return String(output ?? '')
    .split('\x1e')
    .map((record) => record.replace(/^\r?\n/, ''))
    .filter((record) => record.trim())
    .map((record) => {
      const [sha, subject, body] = record.split('\x1f');
      return { sha: (sha ?? '').trim(), subject: (subject ?? '').trim(), body: (body ?? '').trim() };
    })
    .filter((commit) => commit.sha && commit.subject && !commit.subject.startsWith('Merge '));
}

/** Groups commits into the sections of the body, in a fixed order, without empties. */
function groupCommits(commits) {
  const buckets = new Map(SECTIONS.map((section) => [section.title, []]));
  for (const commit of commits) {
    const match = SUBJECT.exec(commit.subject);
    const type = match ? match[1] : null;
    const scope = match ? match[2] : null;
    if (isVersionCut(type, scope)) continue;
    const section = SECTIONS.find((candidate) => candidate.types.includes(type));
    buckets.get(section ? section.title : OTHER_TITLE).push(commit);
  }
  return SECTIONS.map((section) => ({ title: section.title, commits: buckets.get(section.title) })).filter(
    (section) => section.commits.length > 0,
  );
}

/**
 * Builds the Markdown body. `repository` is `owner/name`; without it the entries
 * carry the short sha instead of a link, which keeps the script usable locally.
 */
function buildNotes({ tag, previousTag = null, commits = [], repository = null }) {
  const groups = groupCommits(commits);
  if (groups.length === 0) {
    throw new Error(
      `No commits between ${previousTag ?? 'the first commit'} and ${tag}, so there is no release body to write. ` +
        'A release with an empty body is what this step exists to prevent.',
    );
  }

  const base = repository ? `https://github.com/${repository}` : null;
  const lines = [previousTag ? `Cambios desde \`${previousTag}\` hasta \`${tag}\`.` : `Primer release, \`${tag}\`.`];
  for (const group of groups) {
    lines.push('', `### ${group.title}`, '');
    for (const commit of group.commits) {
      const short = commit.sha.slice(0, 7);
      lines.push(
        base
          ? `- ${commit.subject} ([\`${short}\`](${base}/commit/${commit.sha}))`
          : `- ${commit.subject} (\`${short}\`)`,
      );
    }
  }
  if (base && previousTag) lines.push('', `**Comparar los cambios**: ${base}/compare/${previousTag}...${tag}`);
  return `${lines.join('\n')}\n`;
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8' });

/** The tag the release text should start from, or null when this is the first one. */
function previousTagOf(tag) {
  try {
    return git(['describe', '--tags', '--abbrev=0', `${tag}^`]).trim() || null;
  } catch {
    return null;
  }
}

function notesForTag(tag, { repository = null, previousTag } = {}) {
  const previous = previousTag === undefined ? previousTagOf(tag) : previousTag || null;
  const range = previous ? `${previous}..${tag}` : tag;
  const output = git(['log', '--pretty=format:%H%x1f%s%x1f%b%x1e', range]);
  return buildNotes({ tag, previousTag: previous, commits: parseCommits(output), repository });
}

function main(argv) {
  const options = { tag: '', previousTag: undefined, repository: process.env.GITHUB_REPOSITORY ?? null, out: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--tag') {
      options.tag = String(value ?? '');
      index += 1;
    } else if (argument === '--previous') {
      options.previousTag = String(value ?? '');
      index += 1;
    } else if (argument === '--repository') {
      options.repository = String(value ?? '');
      index += 1;
    } else if (argument === '--out') {
      options.out = String(value ?? '');
      index += 1;
    } else {
      console.error(`Unknown argument: ${argument}`);
      return 1;
    }
  }
  if (!options.tag) {
    console.error(
      'Usage: node scripts/release-notes.cjs --tag v1.2.3 [--previous v1.2.2] [--repository owner/name] [--out file]',
    );
    return 1;
  }

  try {
    const notes = notesForTag(options.tag, options);
    if (options.out) require('node:fs').writeFileSync(options.out, notes, 'utf8');
    else process.stdout.write(notes);
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { SECTIONS, parseCommits, groupCommits, buildNotes, previousTagOf, notesForTag };
