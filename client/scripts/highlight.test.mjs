import assert from 'node:assert/strict';
import test from 'node:test';
import { cachedRender, highlightCode, languageForPath, splitHighlightedLines } from '../src/utils/highlight.js';

test('languageForPath maps common skill-bundle extensions and ignores unknown ones', () => {
  assert.equal(languageForPath('scripts/run.sh'), 'bash');
  assert.equal(languageForPath('a/b/c.TSX'), 'typescript');
  assert.equal(languageForPath('config.toml'), 'ini');
  assert.equal(languageForPath('LICENSE'), null);
  assert.equal(languageForPath('image.png'), null);
});

test('highlightCode escapes unknown languages instead of auto-detecting', () => {
  assert.equal(highlightCode('<a> & b', null), '&lt;a&gt; &amp; b');
  assert.equal(highlightCode('', 'bash'), '');
  assert.match(highlightCode('const x = 1;', 'javascript'), /<span class="hljs-keyword">const<\/span>/);
});

test('splitHighlightedLines closes and reopens spans that cross line breaks', () => {
  const lines = splitHighlightedLines('<span class="s">"a\nb"</span>\n\nend');
  assert.deepEqual(lines, [
    '<span class="s">"a</span>',
    '<span class="s">b"</span>',
    '&nbsp;',
    'end',
  ]);
});

test('cachedRender reuses results for identical source and kind', () => {
  let calls = 0;
  const render = (text) => { calls += 1; return text.toUpperCase(); };
  const source = `cache-test-${Date.now()}`;
  assert.equal(cachedRender('t', source, render), source.toUpperCase());
  assert.equal(cachedRender('t', source, render), source.toUpperCase());
  assert.equal(calls, 1);
  cachedRender('other', source, render);
  assert.equal(calls, 2);
});
