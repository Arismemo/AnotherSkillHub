import assert from 'node:assert/strict';
import test from 'node:test';
import { extractHeadings, parseFrontmatterPairs, slugifyHeading, splitFrontmatter } from '../src/utils/markdownDoc.js';

test('splitFrontmatter separates the leading --- block from the body', () => {
  assert.deepEqual(splitFrontmatter('---\nname: a\n---\n# Title'), { frontmatter: 'name: a', body: '# Title' });
  assert.deepEqual(splitFrontmatter('# No frontmatter'), { frontmatter: '', body: '# No frontmatter' });
  assert.deepEqual(splitFrontmatter('---\nunterminated'), { frontmatter: '', body: '---\nunterminated' });
  assert.deepEqual(splitFrontmatter(''), { frontmatter: '', body: '' });
});

test('extractHeadings keeps h1-h4 and skips headings inside fenced code', () => {
  const md = ['# One', '```bash', '# not a heading', '```', '## Two ##', '~~~', '### hidden', '~~~', '##### five', '#### Four'].join('\n');
  assert.deepEqual(extractHeadings(md), [
    { level: 1, text: 'One' },
    { level: 2, text: 'Two' },
    { level: 4, text: 'Four' },
  ]);
});

test('extractHeadings only closes a fence with the same marker', () => {
  const md = ['```', '~~~', '# inside', '```', '# after'].join('\n');
  assert.deepEqual(extractHeadings(md), [{ level: 1, text: 'after' }]);
});

test('slugifyHeading keeps unicode letters and de-duplicates within one document', () => {
  const used = new Set();
  assert.equal(slugifyHeading('Hello, World!', used), 'hello-world');
  assert.equal(slugifyHeading('Hello World', used), 'hello-world-2');
  assert.equal(slugifyHeading('使用 说明', used), '使用-说明');
  assert.equal(slugifyHeading('!!!', used), 'section');
});

test('parseFrontmatterPairs reads key: value lines and strips surrounding quotes', () => {
  assert.deepEqual(parseFrontmatterPairs('name: "demo"\ndescription: \'x y\'\n  - list item\nversion: 1'), [
    { key: 'name', value: 'demo' },
    { key: 'description', value: 'x y' },
    { key: 'version', value: '1' },
  ]);
  assert.deepEqual(parseFrontmatterPairs(''), []);
});
