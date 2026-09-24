import { useState } from 'react';
import {
  ArrowRight, BookOpen, Bot, Check, Copy, GitCompare, History, KeyRound, Network, Package, ShieldCheck,
} from 'lucide-react';
import { SiteFooter, SiteHeader } from './SiteChrome';

// 终端片段：$ 开头是输入，其余是输出（文案与 ash 的真实输出保持一致）
export function TerminalBlock({ title, lines }) {
  return (
    <figure className="terminal">
      <figcaption><span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />{title}</figcaption>
      <pre>
        {lines.map((line, i) => (
          line.startsWith('$ ')
            ? <div key={i}><span className="prompt">$</span> <span className="cmd">{line.slice(2)}</span></div>
            : <div key={i} className="out">{line}</div>
        ))}
      </pre>
    </figure>
  );
}

export function CopyCommand({ command }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* 剪贴板不可用时用户仍可手动选中 */ }
  };
  return (
    <div className="copy-command">
      <code>{command}</code>
      <button type="button" onClick={copy} aria-label={copied ? '已复制' : `复制：${command}`} title="复制">
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

const HERO_LINES = [
  '$ ash search 部署',
  '共 2 个技能（ash info <slug> 看详情，ash pull <slug> 安装）',
  'deploy-kit  ·  服务部署流程  ·  部署到生产环境之前使用  [Ops]',
  'release-checklist  ·  发布前检查清单  [inbox]',
  '$ ash pull deploy-kit',
  '📦 AnotherSkillHub: 正在安装技能 [deploy-kit]',
  '✓ 完整技能包下载成功',
  '↳ 安装依赖 release-checklist',
  '✅ 技能 [deploy-kit] v1.2.0 已安装到 ~/.claude/skills/deploy-kit',
];

const STEPS = [
  {
    title: '沉淀',
    text: 'Agent 做完一个下次还用得上的流程，把整个目录推上来：SKILL.md、scripts/、references/ 一起打包。',
    lines: ['$ ash push ./deploy-kit', '✅ 已创建技能 deploy-kit（待审核）', '   附属文件: 3 个'],
  },
  {
    title: '审核',
    text: '推送先进「待审核」。网页上看差异、看安全扫描结果（硬编码密钥、危险命令），确认后一键采纳。',
    lines: ['⚠️  安全提醒: 疑似硬编码密钥', '   deploy-kit · 更新待审核 · 与当前版本对比 +12 −3', '   [采纳]  [拒绝]'],
  },
  {
    title: '分发',
    text: '其他机器上的 Agent 一条命令装好技能和它声明的依赖；有更新时 ash outdated 会告诉你。',
    lines: ['$ ash outdated', 'deploy-kit  ·  v1.1.0  ·  有更新 → v1.2.0', '$ ash pull --all', '完成：更新 1 个，跳过 0 个，失败 0 个'],
  },
];

const FEATURES = [
  { icon: History, title: '版本历史', text: '每次修改前自动快照。随时对比差异、回滚到任意版本，给稳定版打标签。' },
  { icon: ShieldCheck, title: '审核与安全扫描', text: 'Agent 的推送先进待审核；命中高危模式的推送即使关闭审核也必须人工确认。' },
  { icon: Package, title: '技能组合', text: '把一类任务要用的技能编成组合，ash pull bundle:<名称> 一次装齐。' },
  { icon: Network, title: '依赖图', text: 'depends_on 声明和 SKILL.md 之间的引用画成一张图，一眼看清谁依赖谁。' },
  { icon: Bot, title: '适配多种 Agent', text: '自动探测 Claude Code、Codex、Hermes、dsh 的技能目录，任何能跑 bash 的 Agent 都能用。' },
  { icon: KeyRound, title: '私有库与个人 token', text: '每个账号一个独立的技能库。终端用可随时吊销的个人 token，不必把密码交给 Agent。' },
];

export default function Landing({ user, registration }) {
  const origin = window.location.origin;
  const primary = user
    ? { href: '/app', label: '进入应用' }
    : registration === 'closed' ? { href: '/login', label: '登录' } : { href: '/register', label: '免费注册' };

  return (
    <div className="landing">
      <a className="skip-link" href="#main">跳到正文</a>
      <SiteHeader user={user} registration={registration} nav={[
        { href: '#workflow', label: '工作流' },
        { href: '#features', label: '功能' },
        { href: '#quickstart', label: '接入' },
        { href: '#self-host', label: '自托管' },
        { href: '/docs', label: '文档' },
      ]} />

      <main id="main">
        <section className="hero">
          <div className="container hero-inner">
            <div className="hero-copy">
              <p className="eyebrow">自托管 · 为 AI Agent 而建</p>
              <h1>把 Agent 做成的流程，<br />沉淀成每台机器都能用的技能</h1>
              <p className="lede">
                笔记本、服务器、GPU 机器上的 Agent 各自摸索出的部署手册、排障步骤和脚本，
                推送到同一个技能库，审核后一条命令分发给所有 Agent。
              </p>
              <div className="hero-cta">
                <a className="btn btn-primary btn-lg" href={primary.href}>{primary.label}<ArrowRight size={16} aria-hidden="true" /></a>
                <a className="btn btn-ghost btn-lg" href="/docs"><BookOpen size={16} aria-hidden="true" />阅读文档</a>
              </div>
              {user && <p className="hero-signed-in">已登录为 <strong>{user.username}</strong></p>}
            </div>
            <TerminalBlock title="任意一台机器上的 Agent" lines={HERO_LINES} />
          </div>
        </section>

        <section id="workflow" className="section">
          <div className="container">
            <h2>推送、审核、分发</h2>
            <p className="section-lede">技能是一个目录：带 frontmatter 的 SKILL.md，加上可选的脚本和参考资料。整个流转只需要三步。</p>
            <ol className="steps">
              {STEPS.map((step, i) => (
                <li key={step.title} className="step">
                  <div className="step-head"><span className="step-index" aria-hidden="true">{i + 1}</span><h3>{step.title}</h3></div>
                  <p>{step.text}</p>
                  <TerminalBlock title={i === 1 ? '网页 · 待审核' : '终端'} lines={step.lines} />
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="features" className="section section-alt">
          <div className="container">
            <h2>团队共享技能需要的东西，都在这里</h2>
            <ul className="features">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <li key={title} className="feature">
                  <span className="feature-icon" aria-hidden="true"><Icon size={18} /></span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="quickstart" className="section">
          <div className="container quickstart">
            <div>
              <h2>三行命令接入一台机器</h2>
              <p className="section-lede">先安装 <code>ash</code> 命令行工具，登录自己的账号，然后就能搜索和安装技能。接入后把一句引导语发给 Agent，它就知道什么时候该来这里查找和推送技能。</p>
              <p className="quickstart-note"><GitCompare size={14} aria-hidden="true" />命令、技能格式、审核规则和 HTTP 接口的完整说明见<a href="/docs">文档</a>。</p>
            </div>
            <ol className="commands">
              <li><span>安装 CLI</span><CopyCommand command={`curl -fsSL ${origin}/setup.sh | bash`} /></li>
              <li><span>登录</span><CopyCommand command="ash login" /></li>
              <li><span>查找并安装</span><CopyCommand command="ash search <关键词> && ash pull <slug>" /></li>
            </ol>
          </div>
        </section>

        <section id="self-host" className="section section-alt">
          <div className="container self-host">
            <div>
              <h2>部署在你自己的服务器上</h2>
              <p className="section-lede">单个 Docker 容器，数据是一个 SQLite 文件和一个目录，备份和迁移都很简单。技能、脚本和 token 都不离开你的机器。</p>
            </div>
            <TerminalBlock title="服务器" lines={['$ git clone https://github.com/Arismemo/AnotherSkillHub.git', '$ cd AnotherSkillHub && docker compose up -d --build', '🚀 AnotherSkillHub Server listening on http://0.0.0.0:9444']} />
          </div>
        </section>

        <section className="section closing">
          <div className="container closing-inner">
            <h2>给你的 Agent 们一个共享的技能库</h2>
            <a className="btn btn-primary btn-lg" href={primary.href}>{primary.label}<ArrowRight size={16} aria-hidden="true" /></a>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
