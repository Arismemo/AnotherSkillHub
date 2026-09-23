import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutGraph, demoGraph } from '../src/utils/graphLayout.js';

test('meta skills remain on the circumference, application skills remain strictly inside', () => {
  const positions = layoutGraph(demoGraph.nodes);
  for (const node of positions.values()) {
    const radius = Math.hypot(node.x - 500, node.y - 400);
    if (node.meta) assert.ok(Math.abs(radius - 310) < .0001);
    else assert.ok(radius < 248);
  }
  assert.equal(positions.size, demoGraph.nodes.length);
  assert.deepEqual(layoutGraph([...demoGraph.nodes].reverse()), positions);
  assert.equal(layoutGraph([]).size, 0);
});
