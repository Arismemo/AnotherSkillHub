// 复制给 Agent 的文案集中在这里：详情页、⌘K、终端接入弹窗共用，措辞只改一处。

// 终端接入的引导语只有一行：真正的使用规范由服务端 /agent.md 下发，更新指南不必重发提示词
export function onboardingPrompt(origin) {
  return `本机已接入 AnotherSkillHub 技能库（${origin}）。开始任务前先运行 \`ash guide\`（没有 ash 时读取 ${origin}/agent.md），按其中的约定搜索、使用和推送技能。`;
}

// 单技能指令：多文件技能直接 fetch 拿不到脚本，要求安装；单文件技能读 Markdown 即可
export function skillPrompt(origin, skill) {
  const fileCount = Number(skill.file_count ?? skill.fileCount ?? 1);
  if (fileCount > 1) {
    return `请安装并使用技能「${skill.name}」：运行 \`ash pull ${skill.slug}\`（没有 ash 时：\`curl -fsSL ${origin}/s/${skill.slug}/install.sh | bash\`），然后阅读安装目录下的 SKILL.md 并按其步骤执行。`;
  }
  return `请阅读并按以下技能执行「${skill.name}」：${origin}/s/${skill.slug}.md`;
}

export function installCommand(origin, slug) {
  return `curl -fsSL ${origin}/s/${slug}/install.sh | bash`;
}
