export function layoutGraph(nodes) {
  const sorted = [...nodes].sort((a, b) => a.slug.localeCompare(b.slug));
  const meta = sorted.filter((node) => node.meta);
  const skills = sorted.filter((node) => !node.meta);
  const positions = new Map();
  meta.forEach((node, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / meta.length;
    positions.set(node.id, { ...node, x: 500 + 310 * Math.cos(angle), y: 400 + 310 * Math.sin(angle) });
  });
  // A stable sunflower distribution keeps ordinary skills strictly inside the ring.
  skills.forEach((node, index) => {
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const radius = 248 * Math.sqrt((index + .5) / Math.max(skills.length, 1));
    positions.set(node.id, { ...node, x: 500 + radius * Math.cos(angle), y: 400 + radius * Math.sin(angle) });
  });
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
export const demoGraph = {
  nodes: [
    ...foundations.map(([slug, name, description], index) => ({ id: `meta-${index}`, slug, name, description, meta: true, folder: '元技能' })),
    ...examples.map((slug, index) => ({ id: `skill-${index}`, slug, name: slug, description: '示例技能，用于预览元技能与应用技能之间的关联。示例连线不代表真实依赖声明。', meta: false, folder: '示例技能' })),
  ],
  edges: examples.flatMap((_, index) => [...new Set([index % 6, (index * 3 + 1) % 6])].map((target) => ({ source: `skill-${index}`, target: `meta-${target}`, kind: index % 5 === 0 ? 'reference' : 'dependency' }))),
  unresolved: [],
};
