// 文本切分（纯函数，不依赖数据库）：相关度排序、相似度、重复步骤比对共用。
// 中文按字二元组、英文按词（去掉常见虚词、简单去复数）；另附一份开发运维高频概念的中英对照，用于查询扩展。

// 查询里常见、却不代表任务内容的词。中文以二元组形式过滤
const STOP_EN = new Set(('a an and are as at be by can do does for from how i in into is it me my of on or our please should so that '
  + 'the this to use using want we what when where which with you your need help make get let some any all just').split(' '));
const STOP_ZH = new Set(['帮我', '一下', '如何', '怎么', '怎样', '我们', '你们', '这个', '那个', '需要', '可以', '进行', '一个', '然后',
  '现在', '请你', '能否', '是否', '什么', '为什么', '时候', '的时', '我想', '想要', '看看', '使用', '用于', '这些', '里的', '的一', '一份']);

// 中英对照：技能库常是中英混写，Agent 用中文描述任务时要能找到英文写的技能，反之亦然。
// 只收开发与运维里的高频概念；扩展出来的词按 EXPANSION_WEIGHT 计分，只加分不抬高满分线
const GLOSSARY = {
  测试: 'test', 调试: 'debug', 根因: 'root cause debug', 排查: 'troubleshoot debug', 报错: 'error', 错误: 'error', 故障: 'failure incident',
  部署: 'deploy', 上线: 'deploy release', 发布: 'release publish', 回滚: 'rollback', 构建: 'build', 编译: 'compile build',
  浏览器: 'browser', 网页: 'web page', 页面: 'page', 网站: 'website site', 登录: 'login', 填表: 'form', 表单: 'form', 截图: 'screenshot',
  文档: 'doc document', 飞书: 'lark feishu', 代码库: 'codebase repo', 仓库: 'repo repository', 代码: 'code',
  审查: 'review', 评审: 'review', 审核: 'review', 重构: 'refactor', 性能: 'performance', 优化: 'optimize',
  设计: 'design', 界面: 'ui interface', 前端: 'frontend', 后端: 'backend', 数据库: 'database', 服务器: 'server',
  容器: 'docker container', 日志: 'log', 监控: 'monitor', 图表: 'chart', 可视化: 'visualization dataviz',
  幻灯片: 'slides presentation', 演示: 'presentation slides', 表格: 'spreadsheet sheet', 翻译: 'translate', 写作: 'writing',
  简洁: 'concise', 总结: 'summary summarize', 摘要: 'summary', 新人: 'onboard onboarding', 新同事: 'onboard onboarding',
  上手: 'onboard', 入门: 'onboard getting started', 介绍: 'overview explain', 解释: 'explain', 计划: 'plan', 规划: 'plan',
  需求: 'requirement spec', 提交: 'commit', 合并: 'merge', 分支: 'branch', 安全: 'security', 漏洞: 'vulnerability security',
  依赖: 'dependency', 升级: 'upgrade', 迁移: 'migrate migration', 自动化: 'automation', 定时: 'schedule cron',
  图片: 'image', 图像: 'image', 视频: 'video', 生成: 'generate', 技能: 'skill', 验证: 'verify verification', 验收: 'verify acceptance',
  感知: 'perception', 检测: 'detection detect', 仿真: 'simulation sim', 回放: 'replay', 进度: 'progress status',
};
const EXPANSION_WEIGHT = 0.6;

const CJK = /[㐀-鿿豈-﫿]/;
const RUN = /[㐀-鿿豈-﫿]+|[a-z0-9]+/g;

function stem(word) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

// 切出词元序列；withSpans 时同时给出每个词元在原串中的位置（用于把命中的二元组拼回可读的词）
function tokenize(text, { withSpans = false } = {}) {
  const tokens = [];
  const spans = [];
  const source = String(text || '').toLowerCase();
  const push = (token, start, end) => { tokens.push(token); if (withSpans) spans.push({ token, start, end }); };
  for (const match of source.matchAll(RUN)) {
    const run = match[0];
    if (CJK.test(run[0])) {
      if (run.length === 1) { push(run, match.index, match.index + 1); continue; }
      for (let i = 0; i < run.length - 1; i += 1) {
        const bigram = run.slice(i, i + 2);
        if (!STOP_ZH.has(bigram)) push(bigram, match.index + i, match.index + i + 2);
      }
    } else if (run.length >= 2 && !STOP_EN.has(run)) {
      push(stem(run), match.index, match.index + run.length);
    }
  }
  return withSpans ? { tokens, spans, source } : tokens;
}

// 反向对照（英文词 → 中文词元），启动时算一次
const GLOSSARY_EN = new Map();
for (const [zh, en] of Object.entries(GLOSSARY)) {
  for (const token of tokenize(en)) GLOSSARY_EN.set(token, [...(GLOSSARY_EN.get(token) || []), ...tokenize(zh)]);
}

// 查询 → { 词元: 权重 }：原词 1，对照扩展出的词 EXPANSION_WEIGHT
function queryTerms(query) {
  const terms = new Map();
  const original = tokenize(query);
  for (const token of original) terms.set(token, 1);
  const expand = (token) => { if (!terms.has(token)) terms.set(token, EXPANSION_WEIGHT); };
  const lower = String(query || '').toLowerCase();
  for (const [zh, en] of Object.entries(GLOSSARY)) if (lower.includes(zh)) tokenize(en).forEach(expand);
  for (const token of original) (GLOSSARY_EN.get(token) || []).forEach(expand);
  return terms;
}

module.exports = { tokenize, queryTerms, stem, CJK, GLOSSARY, EXPANSION_WEIGHT };
