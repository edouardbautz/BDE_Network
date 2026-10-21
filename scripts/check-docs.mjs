// Checks the documentation (every .md file of the repository, except dependencies):
//
//   - every internal link and image points to a file that exists, and every `#anchor` to a heading that exists
//     (headings are slugged like GitHub does);
//   - every image has an alternative text;
//   - the French and English pages are twins: same files, same headings, same images, same code blocks, and each
//     starts with a link to the other language.
//
//   node scripts/check-docs.mjs        (npm run docs:check)
//
// External links are checked once a week by .github/workflows/links.yml, not here: a network error must not stop a
// pull request. No dependency: plain Node.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIPPED_DIRS = new Set(['node_modules', '.git', '.next', 'coverage', 'generated']);

/** Every Markdown file of the repository. */
function markdownFiles(directory = ROOT) {
  const found = [];
  for (const name of readdirSync(directory)) {
    // Dot folders hold tools' files, not documentation (except .github: the issue and pull request templates).
    if (SKIPPED_DIRS.has(name) || (name.startsWith('.') && name !== '.github')) continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) found.push(...markdownFiles(path));
    else if (name.endsWith('.md')) found.push(path);
  }
  return found;
}

const problems = [];
const report = (file, message) =>
  problems.push(`${relative(ROOT, file).split(sep).join('/')}: ${message}`);

/** The text of a file without its fenced code blocks (their content is never a link or a heading). */
function withoutFences(text) {
  const lines = text.split('\n');
  const kept = [];
  let fence = null;
  for (const line of lines) {
    const opening = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (opening && opening[1].startsWith(fence[0]) && opening[1].length >= fence.length)
        fence = null;
      kept.push('');
    } else if (opening) {
      fence = opening[1];
      kept.push('');
    } else kept.push(line);
  }
  return kept.join('\n');
}

/** The text of a heading without its HTML tags: read once, character by character (a bracket opens a tag, the next one closes it). */
function withoutTags(text) {
  let kept = '';
  let inTag = false;
  for (const character of text) {
    if (character === '<') inTag = true;
    else if (character === '>') inTag = false;
    else if (!inTag) kept += character;
  }
  return kept;
}

/** GitHub's anchor of a heading. */
function slugOf(heading) {
  return withoutTags(heading)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .replace(/\*\*?([^*]+)\*\*?/g, '$1')
    .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1$2')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

const parsed = new Map();
/** The headings (with their anchors), links and images of a Markdown file. */
function parse(file) {
  if (parsed.has(file)) return parsed.get(file);
  const text = withoutFences(readFileSync(file, 'utf8'));
  const headings = [];
  const anchors = new Set();
  const seen = new Map();
  for (const match of text.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)) {
    const base = slugOf(match[2]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
    headings.push(match[1].length);
  }
  // Explicit anchors: <a id="..."> or <a name="...">
  for (const match of text.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(match[1]);

  const noInlineCode = text.replace(/`[^`\n]*`/g, '');
  const links = [];
  for (const match of noInlineCode.matchAll(
    /(!?)\[([^\]]*)\]\((<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g,
  )) {
    links.push({
      image: match[1] === '!',
      label: match[2],
      target: match[3].replace(/^<|>$/g, ''),
    });
  }
  for (const match of noInlineCode.matchAll(/<img\s[^>]*src="([^"]+)"[^>]*>/g)) {
    links.push({ image: true, label: /alt="([^"]*)"/.exec(match[0])?.[1] ?? '', target: match[1] });
  }
  const result = { headings, anchors, links, text };
  parsed.set(file, result);
  return result;
}

const files = markdownFiles();

// ---- links, images, anchors -------------------------------------------------------------------------------------------
for (const file of files) {
  const { links, anchors } = parse(file);
  for (const { image, label, target } of links) {
    if (/^(https?:|mailto:|tel:)/i.test(target)) continue;
    if (image && !label.trim()) report(file, `image without alternative text: ${target}`);

    const [path, anchor] = target.split('#');
    const targetFile = path ? resolve(dirname(file), decodeURI(path)) : file;
    if (path && !existsSync(targetFile)) {
      report(file, `broken link: ${target}`);
      continue;
    }
    if (anchor !== undefined && anchor !== '') {
      if (!targetFile.endsWith('.md')) continue; // an anchor in something that is not Markdown: not ours to check
      if (statSync(targetFile).isDirectory()) continue;
      const known = targetFile === file ? anchors : parse(targetFile).anchors;
      if (!known.has(decodeURIComponent(anchor))) report(file, `broken anchor: ${target}`);
    }
  }
}

// ---- French and English pages are twins -----------------------------------------------------------------------------
const rel = (file) => relative(ROOT, file).split(sep).join('/');
const pairs = [];
for (const name of ['README', 'CONTRIBUTING', 'CODE_OF_CONDUCT']) {
  pairs.push([join(ROOT, `${name}.md`), join(ROOT, `${name}.fr.md`)]);
}
const listing = (language) => {
  const directory = join(ROOT, 'docs', language);
  return existsSync(directory) ? readdirSync(directory).filter((name) => name.endsWith('.md')) : [];
};
const french = listing('fr');
const english = listing('en');
for (const name of french) {
  if (!english.includes(name))
    report(join(ROOT, 'docs', 'fr', name), 'no English twin in docs/en/');
}
for (const name of english) {
  if (!french.includes(name)) report(join(ROOT, 'docs', 'en', name), 'no French twin in docs/fr/');
}
for (const name of french.filter((n) => english.includes(n))) {
  pairs.push([join(ROOT, 'docs', 'en', name), join(ROOT, 'docs', 'fr', name)]);
}

const imageNames = (links) => links.filter((l) => l.image).map((l) => l.target.split('/').pop());
const fences = (file) => (readFileSync(file, 'utf8').match(/^\s*(`{3,}|~{3,})/gm) ?? []).length;

for (const [english_, french_] of pairs) {
  if (!existsSync(english_) || !existsSync(french_)) {
    report(
      existsSync(english_) ? french_ : english_,
      'missing: its twin exists in the other language',
    );
    continue;
  }
  const en = parse(english_);
  const fr = parse(french_);
  if (en.headings.join() !== fr.headings.join()) {
    report(
      french_,
      `headings differ from ${rel(english_)} (${fr.headings.length} vs ${en.headings.length})`,
    );
  }
  if (imageNames(en.links).join() !== imageNames(fr.links).join()) {
    report(french_, `images differ from ${rel(english_)}`);
  }
  if (fences(english_) !== fences(french_))
    report(french_, `code blocks differ from ${rel(english_)}`);

  // Each page starts with a link to its twin.
  const firstLine = (file) => readFileSync(file, 'utf8').split('\n')[0] ?? '';
  const points = (file, twin) => {
    const line = firstLine(file);
    const target = /\]\(([^)]+)\)/.exec(line)?.[1];
    return target !== undefined && resolve(dirname(file), target) === twin;
  };
  if (!points(english_, french_)) report(english_, 'the first line must link to the French page');
  if (!points(french_, english_)) report(french_, 'the first line must link to the English page');
}

if (problems.length > 0) {
  console.error(`${problems.length} problem(s) in the documentation:\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
console.log(
  `Documentation OK: ${files.length} Markdown files, links, anchors, images and FR/EN twins checked.`,
);
