import assert from 'node:assert/strict';
import test from 'node:test';
import { installCommand, onboardingPrompt, skillPrompt } from '../src/utils/agentPrompts.js';

const origin = 'https://hub.example';

test('single-file skills point agents at the markdown URL', () => {
  const prompt = skillPrompt(origin, { slug: 'one', name: '单文件', file_count: 1 });
  assert.ok(prompt.includes(`${origin}/s/one.md`));
  assert.ok(!prompt.includes('ash pull'));
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
