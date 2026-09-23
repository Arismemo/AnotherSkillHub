// 画布几何（viewBox 1000×800）：元技能在外环，有关联的应用技能在环带，未关联的聚在圆心
export const GRAPH = { width: 1000, height: 800, cx: 500, cy: 400, ring: 310, inner: 248, core: 88 };

const GAP = 21; // 应用技能之间的最小间距
const ITERATIONS = 90;

function clampRadius(point, min, max) {
  const dx = point.x - GRAPH.cx, dy = point.y - GRAPH.cy;
  const r = Math.hypot(dx, dy);
  if (r < 1e-6) { if (min > 0) { point.x = GRAPH.cx + min; } return; }
  const target = Math.min(max, Math.max(min, r));
  if (target === r) return;
  point.x = GRAPH.cx + dx / r * target;
  point.y = GRAPH.cy + dy / r * target;
}

// 亲和布局：应用技能落在它所依赖元技能的方向上——只依赖一个就贴近那个元技能，
// 依赖分散就往圆心退。之后做确定性的去重叠松弛（同一输入永远同一结果，与输入顺序无关）。
export function layoutGraph(nodes, edges = []) {
  const sorted = [...nodes].sort((a, b) => a.slug.localeCompare(b.slug) || String(a.id).localeCompare(String(b.id)));
  const meta = sorted.filter((node) => node.meta);
  const skills = sorted.filter((node) => !node.meta);
  const positions = new Map();

  const metaIndex = new Map(meta.map((node, index) => [node.id, index]));
  const angleOf = (index) => -Math.PI / 2 + index * Math.PI * 2 / meta.length;
  const usage = new Map();
  const targets = new Map();
  for (const edge of edges) {
    if (!metaIndex.has(edge.target)) continue;
    usage.set(edge.target, (usage.get(edge.target) || 0) + 1);
    if (!targets.has(edge.source)) targets.set(edge.source, new Set());
    targets.get(edge.source).add(metaIndex.get(edge.target));
  }

  meta.forEach((node, index) => {
    const angle = angleOf(index);
    positions.set(node.id, { ...node, angle, usage: usage.get(node.id) || 0,
      x: GRAPH.cx + GRAPH.ring * Math.cos(angle), y: GRAPH.cy + GRAPH.ring * Math.sin(angle) });
  });

  const band = { min: GRAPH.core + 22, max: GRAPH.inner - 10 };
  const linked = [], loose = [];
  for (const node of skills) (targets.has(node.id) ? linked : loose).push(node);

  const points = [];
  linked.forEach((node) => {
    const indexes = [...targets.get(node.id)].sort((a, b) => a - b);
    let vx = 0, vy = 0;
    for (const index of indexes) { vx += Math.cos(angleOf(index)); vy += Math.sin(angleOf(index)); }
    vx /= indexes.length; vy /= indexes.length;
    const strength = Math.hypot(vx, vy);
    const angle = strength > 1e-6 ? Math.atan2(vy, vx) : angleOf(indexes[0]);
    const radius = band.min + (band.max - band.min) * strength;
    points.push({ node, linked: true, x: GRAPH.cx + radius * Math.cos(angle), y: GRAPH.cy + radius * Math.sin(angle) });
  });
  // 未关联的技能在圆心排成向日葵，彼此等距
  loose.forEach((node, index) => {
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const radius = (GRAPH.core - 12) * Math.sqrt((index + .5) / loose.length);
    points.push({ node, linked: false, x: GRAPH.cx + radius * Math.cos(angle), y: GRAPH.cy + radius * Math.sin(angle) });
  });

  // 每轮先按 GAP 大小分格，只和相邻格比较：几百个技能也能保持在几毫秒级
  const cellOf = (value) => Math.floor(value / GAP);
  for (let step = 0; step < ITERATIONS; step += 1) {
    let moved = false;
    const grid = new Map();
    points.forEach((point, index) => {
      const key = `${cellOf(point.x)},${cellOf(point.y)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(index);
    });
    for (let i = 0; i < points.length; i += 1) {
      const cx = cellOf(points[i].x), cy = cellOf(points[i].y);
      const neighbors = [];
      for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
        for (let gy = cy - 1; gy <= cy + 1; gy += 1) {
          for (const j of grid.get(`${gx},${gy}`) || []) if (j > i) neighbors.push(j);
        }
      }
      neighbors.sort((p, q) => p - q);
      for (const j of neighbors) {
        const a = points[i], b = points[j];
        let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        if (d >= GAP) continue;
        if (d < 1e-6) { const t = (i * 7 + j) * 2.399963; dx = Math.cos(t); dy = Math.sin(t); d = 1; } else { dx /= d; dy /= d; }
        const push = (GAP - Math.min(d, GAP)) / 2;
        a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push;
        moved = true;
      }
    }
    for (const point of points) {
      if (point.linked) clampRadius(point, band.min, band.max);
      else clampRadius(point, 0, GRAPH.core - 8);
    }
    if (!moved) break;
  }

  for (const { node, x, y } of points) {
    positions.set(node.id, { ...node, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
  }
  return positions;
}

const foundations = [
  ['verification-discipline', '验收与证据', '统一验收标准，让每个完成结论都有证据。'],
  ['meta-skill-spec', '元技能规范', '定义可复用能力的边界与引用规范。'],
  ['systematic-debugging', '系统化调试', '从复现、假设到验证，建立可追溯的调试过程。'],
  ['write-concisely', '简洁表达', '让文档与交付信息清晰、准确、易读。'],
  ['security-best-practices', '安全基础', '检查输入、权限与敏感信息的处理。'],
  ['spec-execution-discipline', '规格执行', '把需求、实现和端到端验收连接起来。'],
];
const examples = ['code-reviewer', 'refactor', 'dev-expert', 'tdd', 'autopilot', 'run-to-completion', 'frontend-design', 'design-review-panel', 'web-design-guidelines', 'image-to-code', 'deploy-to-vercel', 'pipeline-audit-loop', 'diagnosing-bugs', 'observability', 'aligned-stride-audit', 'tl-replay-verify', 'thor-bench', 'sdk', 'create-skill', 'skill-retro', 'session-distill', 'env-init', 'onboard', 'vision', 'product-manager-toolkit', 'writing-guidelines', 'progress-report', 'lark-doc', 'lark-base', 'lark-workflow', 'presentations', 'spreadsheets', 'pdf', 'new-repo', 'split-to-prs', 'verify-on-main'];
const standalone = ['scratchpad', 'color-picker', 'daily-notes', 'regex-lab'];
export const demoGraph = {
  nodes: [
    ...foundations.map(([slug, name, description], index) => ({ id: `meta-${index}`, slug, name, description, meta: true, folder: '元技能' })),
    ...examples.map((slug, index) => ({ id: `skill-${index}`, slug, name: slug, description: '示例技能，用于预览元技能与应用技能之间的关联。示例连线不代表真实依赖声明。', meta: false, folder: '示例技能' })),
    ...standalone.map((slug, index) => ({ id: `loose-${index}`, slug, name: slug, description: '示例技能，暂未声明任何元技能依赖。', meta: false, folder: '示例技能' })),
  ],
  // 多数示例只依赖一两个元技能，才能看出"靠近所依赖的基础能力"的布局
  edges: examples.flatMap((_, index) => [...new Set(index % 4 === 0 ? [index % 6, (index + 2) % 6] : [index % 6])]
    .map((target) => ({ source: `skill-${index}`, target: `meta-${target}`, kind: index % 5 === 0 ? 'reference' : 'dependency' }))),
  unresolved: [],
};
