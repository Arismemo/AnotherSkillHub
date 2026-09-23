import test from 'node:test';
import assert from 'node:assert/strict';
import { GRAPH, layoutGraph, demoGraph } from '../src/utils/graphLayout.js';

const radius = (node) => Math.hypot(node.x - GRAPH.cx, node.y - GRAPH.cy);

test('meta skills sit on the ring, linked skills in the band, unlinked skills in the core', () => {
  const positions = layoutGraph(demoGraph.nodes, demoGraph.edges);
  const linked = new Set(demoGraph.edges.map((edge) => edge.source));
  assert.equal(positions.size, demoGraph.nodes.length);
  for (const node of positions.values()) {
    if (node.meta) assert.ok(Math.abs(radius(node) - GRAPH.ring) < .0001);
    else if (linked.has(node.id)) assert.ok(radius(node) > GRAPH.core && radius(node) < GRAPH.inner, node.slug);
    else assert.ok(radius(node) < GRAPH.core, node.slug);
  }
});

test('layout is deterministic and independent of input order', () => {
  const positions = layoutGraph(demoGraph.nodes, demoGraph.edges);
  assert.deepEqual(layoutGraph([...demoGraph.nodes].reverse(), [...demoGraph.edges].reverse()), positions);
  assert.equal(layoutGraph([]).size, 0);
  assert.equal(layoutGraph(demoGraph.nodes).size, demoGraph.nodes.length);
});

test('a skill with a single dependency lands nearest to that meta skill', () => {
  const positions = layoutGraph(demoGraph.nodes, demoGraph.edges);
  const metas = [...positions.values()].filter((node) => node.meta);
  const targets = new Map();
  for (const edge of demoGraph.edges) targets.set(edge.source, [...(targets.get(edge.source) || []), edge.target]);
  for (const [source, list] of targets) {
    if (list.length !== 1) continue;
    const node = positions.get(source);
    const nearest = metas.reduce((best, meta) => (Math.hypot(meta.x - node.x, meta.y - node.y) < Math.hypot(best.x - node.x, best.y - node.y) ? meta : best));
    assert.equal(nearest.id, list[0], node.slug);
  }
});

test('application skills never overlap', () => {
  const nodes = [...layoutGraph(demoGraph.nodes, demoGraph.edges).values()].filter((node) => !node.meta);
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      assert.ok(Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y) > 12, `${nodes[i].slug} × ${nodes[j].slug}`);
    }
  }
});
