// 复制给 Agent 的文案集中在这里：详情页、⌘K、终端接入弹窗共用，措辞只改一处。
// 技能库需要登录：Agent 用 ash（token 在 ~/.ash/token），没有 ash 时 curl 带上同一个 token。

// 与服务端 shell.js 的 curlPipeCommand 保持一致：token 取 ASH_TOKEN，否则取 ash login 保存的文件
const AUTH_HEADER = '-H "Authorization: Bearer ${ASH_TOKEN:-$(cat ~/.ash/token)}"';

// 终端接入的引导语只有一行：真正的使用规范由服务端 /agent.md 下发，更新指南不必重发提示词
export function onboardingPrompt(origin) {
  return `本机已接入 AnotherSkillHub 技能库（${origin}）。开始任务前先运行 \`ash guide\`（没有 ash 时读取 ${origin}/agent.md），按其中的约定搜索、使用和推送技能；提示未登录时请我运行 \`ash login\`。`;
}

// 单技能指令：多文件技能直接读取拿不到脚本，要求安装；单文件技能读 Markdown 即可
export function skillPrompt(origin, skill) {
  const fileCount = Number(skill.file_count ?? skill.fileCount ?? 1);
  if (fileCount > 1) {
    return `请安装并使用技能「${skill.name}」：运行 \`ash pull ${skill.slug}\`（没有 ash 时：\`${installCommand(origin, skill.slug)}\`），然后阅读安装目录下的 SKILL.md 并按其步骤执行。`;
  }
  return `请阅读并按以下技能执行「${skill.name}」：运行 \`ash show ${skill.slug}\`（没有 ash 时：\`curl -fsSL ${AUTH_HEADER} ${origin}/s/${skill.slug}.md\`）。`;
}

export function installCommand(origin, slug) {
  return `curl -fsSL ${AUTH_HEADER} ${origin}/s/${slug}/install.sh | bash`;
}
