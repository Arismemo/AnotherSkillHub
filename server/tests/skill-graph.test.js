const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSkillGraph } = require('../skillGraph');
const meta = { id: 1, slug: 'verify', name: '验证', content: '---\ntype: meta\n---\n', tags: '[]' };

test('graph distinguishes declarations from local references and excludes prose, samples and remote links', () => {
  const graph = buildSkillGraph([meta,
    { id: 2, slug: 'declared', content: '---\ndepends_on: [verify, missing, verify]\n---\n[verify](../verify/SKILL.md)' },
    { id: 3, slug: 'linked', content: '[verify](../verify/SKILL.md#rules)' },
    { id: 4, slug: 'mention', content: 'verify is an example. [verify](https://host/verify/SKILL.md)\n```md\n[verify](../verify/SKILL.md)\n```' },
    { id: 5, slug: 'deleted', is_deleted: 1, content: '---\ndepends_on: [verify]\n---' },
  ]);
  assert.deepEqual(graph.edges, [{ source: 2, target: 1, kind: 'dependency' }, { source: 3, target: 1, kind: 'reference' }]);
  assert.deepEqual(graph.unresolved, [{ source: 2, target: 'missing' }]);
  assert.equal(graph.nodes.length, 4);
  assert.ok(!('content' in graph.nodes[0]));
});

test('metadata failures are isolated and only actual meta targets produce graph edges', () => {
  const graph = buildSkillGraph([meta,
    { id: 2, slug: 'ordinary', description: '使用元技能完成任务', content: '' },
    { id: 3, slug: 'broken', content: '---\ntype: [\n---' },
    { id: 4, slug: 'tagged', tags: '["元技能"]', content: '' },
    { id: 5, slug: 'prefix', description: '【元技能·规范】说明', content: '' },
    { id: 6, slug: 'caller', content: '---\ndependencies: [ordinary, verify, tagged, prefix]\n---' },
  ]);
  assert.equal(graph.nodes.find((n) => n.id === 3).warning, true);
  assert.equal(graph.nodes.find((n) => n.id === 2).meta, false);
  assert.deepEqual(graph.edges.map((edge) => edge.target), [1, 4, 5]);
});
