import assert from 'node:assert/strict';
import test from 'node:test';
import { installCommand, onboardingPrompt, skillPrompt } from '../src/utils/agentPrompts.js';

const origin = 'https://hub.example';

test('single-file skills point agents at the markdown, read with their token', () => {
  const prompt = skillPrompt(origin, { slug: 'one', name: '单文件', file_count: 1 });
  assert.ok(prompt.includes('ash show one'));
  assert.ok(prompt.includes(`${origin}/s/one.md`));
  assert.ok(prompt.includes('Authorization: Bearer'));
  assert.ok(!prompt.includes('ash pull'));
});

test('install command carries the token and never embeds a literal one', () => {
  const command = installCommand(origin, 'kit');
  assert.match(command, /-H "Authorization: Bearer \$\{ASH_TOKEN:-\$\(cat ~\/\.ash\/token\)\}"/);
  assert.ok(command.endsWith(`${origin}/s/kit/install.sh | bash`));
});

test('multi-file skills ask agents to install so scripts are available', () => {
  const prompt = skillPrompt(origin, { slug: 'kit', name: '多文件', file_count: 3 });
  assert.ok(prompt.includes('ash pull kit'));
  assert.ok(prompt.includes(installCommand(origin, 'kit')));
});

test('onboarding prompt is one line that defers to the server-side guide', () => {
  const prompt = onboardingPrompt(origin);
  assert.ok(!prompt.includes('\n'));
  assert.ok(prompt.includes('ash guide'));
  assert.ok(prompt.includes(`${origin}/agent.md`));
});
