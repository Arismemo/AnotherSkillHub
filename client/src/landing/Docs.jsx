// /docs：面向人的完整文档。事实来源：CLI 帮助（server/templates/cli.sh）、Agent 指南（agent.md）、
// 元数据规则（server/skillMeta.js）、安全扫描（server/security.js）、配置项与快捷键注册表（App.jsx）。改那些地方时同步这里。
// 表格内容写成静态数组，key 在 Table 渲染时按行列下标补上，数组字面量里的 JSX 不需要各自带 key。
/* oxlint-disable react/jsx-key */
import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { onboardingPrompt } from '../utils/agentPrompts';
import { SiteFooter, SiteHeader } from './SiteChrome';

const TOC = [
  { group: '入门', items: [['overview', '概览'], ['quickstart', '快速开始'], ['accounts', '账号与 token']] },
  { group: '技能', items: [['skill-format', '技能格式'], ['cli', 'ash 命令行'], ['local', '安装与本地管理'], ['push-review', '推送与审核'], ['versions', '版本历史'], ['references', '技能之间的引用'], ['bundles', '技能组合'], ['share', '分享链接'], ['graph', '依赖图']] },
  { group: '使用', items: [['web', '网页端'], ['agents', '接入 Agent'], ['http', 'HTTP 接口']] },
  { group: '运维', items: [['self-host', '自托管与配置'], ['security', '安全模型'], ['faq', '常见问题']] },
];

function CodeBlock({ children, copy = true }) {
  const [copied, setCopied] = useState(false);
  const text = String(children).replace(/\n$/, '');
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* 剪贴板不可用时可手动选中 */ }
  };
  return (
    <div className="doc-code">
      <pre><code>{text}</code></pre>
      {copy && (
        <button type="button" onClick={onCopy} aria-label={copied ? '已复制' : '复制代码'} title="复制">
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      )}
    </div>
  );
}

function Section({ id, title, children }) {
  return (
    <section id={id} className="doc-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}><a href={`#${id}`}>{title}</a></h2>
      {children}
    </section>
  );
}

function Table({ head, rows }) {
  return (
    <div className="doc-table-wrap">
      <table className="doc-table">
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const C = ({ children }) => <code>{children}</code>;

// 滚动时高亮目录里当前所在的章节：最后一个标题已滚到顶栏下方的章节
function useActiveSection(ids) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 96) current = id;
      }
      // 滚到底时最后几节标题到不了顶部，直接算最后一节
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = ids[ids.length - 1];
      setActive(current);
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); if (frame) window.cancelAnimationFrame(frame); };
  }, [ids]);
  return active;
}

const SECTION_IDS = TOC.flatMap((g) => g.items.map(([id]) => id));

export default function Docs({ user, registration }) {
  const origin = window.location.origin;
  const active = useActiveSection(SECTION_IDS);
  // 宽屏目录常驻；窄屏目录收成页首的折叠块，默认收起
  const [tocOpen] = useState(() => window.matchMedia('(min-width: 960px)').matches);

  useEffect(() => {
    document.title = '文档 · AnotherSkillHub';
    // 内容在挂载后才生成，浏览器打开 /docs#cli 时的锚点跳转落空，这里补一次
    const target = window.location.hash && document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    if (target) window.requestAnimationFrame(() => target.scrollIntoView({ behavior: 'instant' }));
  }, []);

  return (
    <div className="landing docs-page">
      <a className="skip-link" href="#doc-content">跳到正文</a>
      <SiteHeader user={user} registration={registration} nav={[{ href: '/', label: '首页' }, { href: '/docs', label: '文档', current: true }]} />

      <div className="container docs-layout">
        <nav className="docs-toc" aria-label="文档目录">
          <details open={tocOpen}>
            <summary>目录</summary>
            {TOC.map(({ group, items }) => (
              <div key={group} className="docs-toc-group">
                <p>{group}</p>
                <ul>
                  {items.map(([id, label]) => (
                    <li key={id}><a href={`#${id}`} aria-current={active === id ? 'location' : undefined}>{label}</a></li>
                  ))}
                </ul>
              </div>
            ))}
          </details>
        </nav>

        <main id="doc-content" className="docs-content">
          <header className="docs-intro">
            <p className="eyebrow">文档</p>
            <h1>AnotherSkillHub 使用手册</h1>
            <p className="lede">从第一次登录，到把每台机器上的 Agent 接进来，再到自己部署和运维，所有用得到的知识都在这一页。</p>
          </header>

          <Section id="overview" title="概览">
            <p>AnotherSkillHub 是一个自托管的 <strong>Agent 技能库</strong>。不同机器上的 Agent 把做成的流程（部署手册、排障步骤、脚本）推送上来，人在网页上审核，其他 Agent 再用一条命令安装使用。</p>
            <Table head={['概念', '说明']} rows={[
              ['技能（skill）', <>一个目录：入口文件 <C>SKILL.md</C>（带 YAML frontmatter），加上可选的 <C>scripts/</C>、<C>references/</C> 等附属文件。用英文标识符（slug）区分。</>],
              ['账号与私有库', '每个账号有自己独立的技能库：技能、文件夹、组合、审核队列都只属于这个账号，其他账号看不到。'],
              ['API token', <>给 <C>ash</C> 命令行和 Agent 用的凭证，权限等同于账号，可随时吊销。</>],
              ['审核', '通过命令行或接口推送的新技能和更新先进入「待审核」，人工采纳后 Agent 才能拉取。网页上直接新建的技能不需要审核。'],
              ['技能组合（bundle）', '一组技能的快捷集合，可以一条命令全部安装。'],
              ['依赖', <>技能可以在 frontmatter 里用 <C>depends_on</C> 声明依赖的其他技能，安装时一并安装。</>],
            ]} />
          </Section>

          <Section id="quickstart" title="快速开始">
            <ol className="doc-steps">
              <li>
                <h3>在网页上注册或登录</h3>
                <p>打开 <a href="/register">注册页</a>（管理员关闭注册时请联系管理员开账号）。登录后进入 <a href="/app">应用</a>，新账号自带几份示例技能。</p>
              </li>
              <li>
                <h3>在每台机器上安装 ash</h3>
                <CodeBlock>{`curl -fsSL ${origin}/setup.sh | bash`}</CodeBlock>
                <p>安装脚本不需要登录，也不会卡在 sudo 密码提示上：优先写入可写的 bin 目录，其次用免密 <C>sudo -n</C>，最后放到 <C>~/.local/bin</C>。</p>
              </li>
              <li>
                <h3>登录</h3>
                <CodeBlock>ash login</CodeBlock>
                <p>输入用户名和密码，换取一个保存在 <C>~/.ash/token</C> 的 API token。不方便交互输入的机器（服务器、CI），先在网页「账户」里创建 token，再运行 <C>ash login --token &lt;token&gt;</C>。</p>
              </li>
              <li>
                <h3>查找并安装技能</h3>
                <CodeBlock>{'ash suggest "把服务部署到测试环境"\nash info <slug>\nash pull <slug>'}</CodeBlock>
              </li>
              <li>
                <h3>让 Agent 用起来</h3>
                <p>把下面这句话发给 Agent，或写进它的全局指令（<C>CLAUDE.md</C>、<C>AGENTS.md</C> 等）。详细约定由服务端的 <a href="/agent.md">/agent.md</a> 下发，见 <a href="#agents">接入 Agent</a>。</p>
                <CodeBlock>{onboardingPrompt(origin)}</CodeBlock>
              </li>
            </ol>
          </Section>

          <Section id="accounts" title="账号与 token">
            <h3>账号</h3>
            <ul>
              <li>用户名是 3–32 位小写字母、数字、<C>-</C> 或 <C>_</C>，不区分大小写；密码至少 8 位。</li>
              <li>全新实例上第一个注册的账号自动成为管理员。管理员也可以在服务器上用命令创建账号，见 <a href="#self-host">自托管与配置</a>。</li>
              <li>网页登录 30 天有效。在「账户」里修改密码会让其他设备上的网页登录失效，当前页面保持登录；已创建的 API token 不受影响。</li>
              <li>同一 IP 或同一用户名 10 分钟内连续失败 10 次会被暂时锁定，窗口结束后自动解除。</li>
            </ul>
            <h3>API token</h3>
            <ul>
              <li>在应用侧栏底部的「账户」里创建和吊销。token 以 <C>ash_</C> 开头，<strong>只在创建时显示一次</strong>，服务端只保存它的哈希。</li>
              <li><C>ash login</C> 用用户名密码登录时会自动创建一个名为「ash CLI @ 主机名」的 token。</li>
              <li>建议一台机器一个 token，不用了就吊销；列表里能看到每个 token 最近一次使用的时间。</li>
              <li>token 能读写你的整个技能库，但<strong>不能</strong>用来创建新 token 或修改密码，这些只能在网页上做。</li>
              <li>命令行里 token 的来源：环境变量 <C>ASH_TOKEN</C> 优先，其次是 <C>~/.ash/token</C>。</li>
            </ul>
            <CodeBlock>{'ash login                  # 用户名 + 密码\nash login --token ash_…    # 直接保存网页上创建的 token\nash whoami                 # 当前账号\nash logout                 # 删除本机 token（彻底作废请到网页吊销）'}</CodeBlock>
          </Section>

          <Section id="skill-format" title="技能格式">
            <CodeBlock copy={false}>{'my-skill/\n├── SKILL.md          # 必需：YAML frontmatter + Markdown 正文\n├── scripts/          # 可选：可执行脚本（安装时自动加执行权限）\n└── references/       # 可选：正文引用的参考资料'}</CodeBlock>
            <CodeBlock>{`---
name: my-skill              # 英文标识符 slug，也是安装目录名
description: 一句话说明「什么时候应该使用这个技能」，Agent 靠它判断是否调用
description_en: Use when …  # 另一种语言的描述（description 是英文时写 description_zh）
tags: [ops, debugging]
version: 1.0.0
depends_on: [other-skill]   # 可选，引用的其他技能，见「技能之间的引用」
---

# 人类可读的标题

## 何时使用
触发条件和适用范围。

## 步骤
1. 具体、可执行的命令或操作

## 验证
怎样确认完成，以及常见失败的处理办法。`}</CodeBlock>
            <h3>字段识别规则</h3>
            <p>网页新建、粘贴导入和 Agent 推送共用同一套规则：</p>
            <Table head={['字段', '取值顺序']} rows={[
              ['slug', <>显式传入 → frontmatter <C>name</C> → 文件名 → 正文第一个 <C># 标题</C>，取第一个能转成英文标识符的（只保留小写字母、数字、<C>-</C>、<C>_</C>）。纯中文得不到 slug，会报错。</>],
              ['显示名称', <>显式传入 → 正文第一个 <C># 标题</C> → frontmatter <C>name</C> → 文件名</>],
              ['description', '显式传入 → frontmatter description。缺少时会提示：写清「何时使用」，Agent 靠它判断。'],
              ['双语描述', <><C>description_en</C> / <C>description_zh</C>（也认 <C>metadata</C> 里的同名键），补上 description 缺的那种语言；<C>title_en</C> / <C>title_zh</C> 可选。缺一种语言时会提示。</>],
              ['tags', '数组或逗号分隔的字符串都可以'],
              ['version', <>默认 <C>1.0.0</C></>],
              ['依赖', <><C>depends_on</C>、<C>dependencies</C>、<C>requires</C> 或 <C>metadata.depends_on</C>（metadata 里写成逗号分隔的字符串）</>],
            ]} />
            <h3>为什么要双语描述</h3>
            <p>技能库常是中英混写的。只有一种语言的描述时，用另一种语言描述的任务找不到它，内容相同、语言不同的两个技能也查不出重复。补一句另一种语言的 description 就够了：检索和查重都会用上它，以后网页做双语界面也直接用它。给已有技能补：<C>ash lint --only bilingual</C> 列出缺的；<strong>只改双语字段的更新直接发布，不用审核</strong>（Agent 框架不读这些字段，不影响 Agent 的行为）。配置了语义层时，没有双语描述的技能也能跨语言查重。正文不用写两份——两份正文要同步维护、迟早不一致，而读正文的 Agent 中英文都懂。</p>
            <h3>附属文件限制</h3>
            <ul>
              <li>只收文本类文件（.md .sh .py .js .ts .json .yaml .toml .sql .csv .svg 等）；二进制、压缩包、密钥文件（.pem .key .env）会被跳过。服务端可用 <C>ASH_ALLOWED_EXTS</C> 调整白名单。</li>
              <li>单个文件不超过 512KB，总量不超过 4MB，最多 200 个；超出的文件被跳过，并在推送结果里列出。</li>
              <li>推送目录时自动排除 <C>.git</C>、<C>node_modules</C>、<C>__pycache__</C>、<C>.DS_Store</C> 和 <C>.ash</C>。</li>
            </ul>
          </Section>

          <Section id="cli" title="ash 命令行">
            <h3>安装与更新</h3>
            <ul>
              <li>安装：<C>curl -fsSL {origin}/setup.sh | bash</C>。<C>ash update</C> 更新到服务端的最新版本；服务端升级后建议每台机器都执行一次。</li>
              <li>也可以用 npm 包装版：首次运行 <C>ash config &lt;服务地址&gt;</C>，之后行为与脚本版完全一致（核心逻辑始终从服务端下载）。</li>
              <li>CLI 兼容 macOS 自带的 bash 3.2，本体只依赖 bash、curl、tar。例外是 Claude Code hook（<C>ash hooks</C>）：安装时要修改 settings.json、每轮结束要解析会话记录，需要本机有 node 或 python3。</li>
            </ul>
            <h3>命令参考</h3>
            <Table head={['命令', '作用']} rows={[
              [<C>ash login [--token T]</C>, '登录；ash whoami 查看账号，ash logout 删除本机 token'],
              [<C>ash suggest "&lt;任务描述&gt;" [--limit N] [--json]</C>, '按任务描述找相关技能，标明「相关 / 可能相关」；没有合适的会直接说没有'],
              [<C>ash search &lt;关键词…&gt; [--tag T] [--folder F] [--json]</C>, '搜索已发布技能，多个关键词需同时命中（名称、slug、描述、正文）；都不命中时给出相关候选'],
              [<C>ash list [--tag T] [--folder F] [--json]</C>, '列出已发布技能'],
              [<C>ash info &lt;slug&gt;</C>, '描述、依赖（含缺失的依赖）、使用情况与健康信号、文件清单、版本、修订号和安装命令'],
              [<C>ash show &lt;slug&gt; [--version ID] [--pending]</C>, '直接输出 SKILL.md，不安装'],
              [<C>ash versions &lt;slug&gt;</C>, '历史版本列表'],
              [<C>ash pull &lt;slug&gt;[@版本] [选项]</C>, <>安装技能及其依赖：只在 <C>~/.ash/skills</C> 存一份，再链接进本机每个 Agent 的技能目录（<C>--agent claude|codex|hermes|dsh|all</C> 只链接给那个 Agent；<C>--dir PATH</C> 直接装进指定目录、不建链接）。其余选项：<C>--pending</C>、<C>--force</C>、<C>--no-deps</C>；<C>@版本</C> 安装历史里的那一版并固定</>],
              [<C>ash pull bundle:&lt;标识或名称&gt;</C>, '安装整个技能组合'],
              [<C>ash pull &lt;分享链接&gt;</C>, <>从别人发来的分享链接安装（可以是另一台服务器的链接，不会发送你的 token）；密码分享会提示输入，或事先设 <C>ASH_SHARE_PASSWORD</C></>],
              [<C>ash pull --all [--dir PATH] [--force]</C>, '更新所有过期的已装技能（本地改过的跳过，除非 --force）'],
              [<><C>ash installed [--dir PATH]</C> / <C>ash outdated [--dir PATH]</C></>, '本机已装技能及状态 / 只列需要处理的'],
              [<C>ash remove &lt;slug&gt; [--dir PATH] [--force]</C>, '卸载；本地改过的先备份'],
              [<><C>ash bundles</C> / <C>ash bundle &lt;标识或名称&gt;</C></>, '列出组合 / 查看组合成员'],
              [<C>ash new &lt;slug&gt; [--meta] [--dir PATH]</C>, '新技能不要从空白写起：生成符合规范的骨架（frontmatter、description 模板；--meta 带契约与被谁引用两节），写完用 ash lint <目录> 自查'],
              [<C>ash push &lt;目录|SKILL.md&gt; [--update] [--folder PATH]</C>, '推送技能；同名已存在时必须加 --update'],
              [<C>ash share &lt;slug&gt; [--label 文本] [--password [密码]] [--expires 1d|7d|30d|never] [--latest]</C>, '创建分享链接：默认冻结当前版本、7 天有效；--latest 始终显示最新已发布版本，--password 不带值时提示输入'],
              [<><C>ash shares [slug]</C> / <C>ash unshare &lt;#id|链接&gt;</C></>, '列出我的分享链接（版本、访问方式、到期、浏览 / 取用次数）/ 停用一条'],
              [<C>ash mine</C>, '本机推送过的技能及审核结果'],
              [<C>ash withdraw &lt;slug&gt;</C>, '撤回自己仍在待审核的推送'],
              [<C>ash feedback &lt;slug&gt; ok|fail ["说明"] [--dir PATH]</C>, '用完技能后回报结果，自动对应本机已装的版本'],
              [<C>ash lint [slug|技能目录] [--only CODE] [--all] [--json]</C>, <>技能检查：写作约定、双语描述、引用、元技能契约、重复的步骤、能否被 Agent 调用。传本地目录时检查还没推送的草稿；不带参数检查全库（默认只列 ⚠️，<C>--all</C> 连写作风格提示一起列）；<C>--only bilingual</C> 只看缺双语描述的</>],
              [<C>ash doctor [--fix] [--dir PATH]</C>, '检查本机各 Agent 能不能用上已装的技能：引用的技能在不在旁边、目录有没有 Agent 加载；--fix 自动补装'],
              [<C>ash migrate [--apply] [--keep-copies]</C>, <>把本机已有的技能换成共享存储 + 链接：ash 装的搬进存储（原位置换成链接）、已改名或合并的旧名换成新名、和库里同名的手动副本先备份再换成库里的版本（<C>--keep-copies</C> 不动手动副本）。默认只列计划，<C>--apply</C> 执行</>],
              [<C>ash import [目录…] [--folder PATH] [--update] [--dry-run] [--no-adopt]</C>, <>把本机已有、不是 ash 装的技能一次推送进库（默认扫描各 Agent 的技能目录）。同名已在库里的跳过（<C>--update</C> 提交为更新）；导入的目录登记为 ash 管理（<C>--no-adopt</C> 不登记），之后 <C>ash installed</C> / <C>ash outdated</C> 能管到它们。登记的目录留在原处、不会立即迁入共享存储：审核采纳后先 <C>ash migrate</C> 看迁移计划，再 <C>ash migrate --apply</C> 迁入并链接给各 Agent</>],
              [<C>ash stats [--days N] [--json]</C>, '最近 N 天（默认 30）的使用次数、反馈次数和反馈率，按机器拆分'],
              [<C>ash hooks install|uninstall|status</C>, <>在 Claude Code 里装一个 Stop hook：用到的技能自动记入库里，用了却没回报的提醒 Agent 回报一次。需要本机有 node 或 python3</>],
              [<C>ash guide [--full]</C>, '输出 Agent 使用指南（精简版；--full 完整规范）'],
              [<C>ash open</C>, '在浏览器打开应用'],
              [<C>ash update</C>, '更新 ash 自身'],
            ]} />
            <h3>环境变量</h3>
            <Table head={['变量', '作用']} rows={[
              [<C>ASH_SERVER_URL</C>, '服务地址（默认是安装时的地址）'],
              [<C>ASH_TOKEN</C>, <>API token，优先于 <C>~/.ash/token</C></>],
              [<C>ASH_STORE</C>, <>共享存储目录（默认 <C>~/.ash/skills</C>）：ash 装的技能只在这里存一份，各 Agent 目录里放指向它的链接</>],
              [<C>ASH_SKILLS_DIR</C>, <>不用共享存储，技能直接装进这个目录（同 <C>--dir</C>），不建链接</>],
              [<C>ASH_AGENT</C>, <>未指定 <C>--agent</C> / <C>--dir</C> / <C>ASH_SKILLS_DIR</C> 时链接给哪个 Agent：claude、codex、hermes、dsh 或 all（链接给每个 Agent）</>],
              [<C>ASH_TERMINAL</C>, '推送时记录的来源名，默认是主机名；ash mine / withdraw 按它识别「本机的推送」'],
              [<C>ASH_BIN_DIR</C>, 'ash 自身的安装位置'],
              [<C>ASH_FEEDBACK_HINT</C>, <>设为 <C>0</C> 时安装不在 SKILL.md 末尾附加反馈提示</>],
              [<C>ASH_SHARE_PASSWORD</C>, <><C>ash pull &lt;分享链接&gt;</C> 遇到密码分享时使用的密码（无人值守时用；不设则提示输入）</>],
            ]} />
          </Section>

          <Section id="local" title="安装与本地管理">
            <h3>装到哪里</h3>
            <p>默认装进共享存储：每个技能只在 <C>~/.ash/skills/&lt;slug&gt;</C>（<C>ASH_STORE</C> 可改）存一份，再在本机每个存在的 Agent 技能目录里放一个指向它的符号链接——几个 Agent 用的是同一份、同一个版本，库里装来的技能和 Agent 自带、自己写的也不混在一起。<C>--agent</C> 只链接给指定的 Agent（claude、codex、hermes、dsh 或 all）；<C>--dir</C> 和 <C>ASH_SKILLS_DIR</C> 不走共享存储，把文件直接装进指定目录、不建链接。</p>
            <p>升级到共享存储布局之前装的技能还留在 Agent 目录里，<C>ash migrate</C> 会列出迁移计划：ash 装的搬进存储（原位置换成链接）、已改名或合并的旧名换成新名、和库里同名的手动副本先备份再换成库里的版本（<C>--keep-copies</C> 不动手动副本）。默认只列计划，确认后 <C>ash migrate --apply</C> 执行。</p>
            <h3>安装做了什么</h3>
            <ul>
              <li>下载完整技能包，先解压到同级的临时目录，成功后整体替换，所以上游删掉的文件本地也会消失。</li>
              <li>在技能目录里写一个 <C>.ash</C> 文件，记录来源服务、修订号、版本和内容指纹。<strong>不要编辑或删除它</strong>，推送时会自动排除。</li>
              <li>同名目录本地改过、或不是 ash 装的，会先备份到 <C>~/.ash/backups/</C> 再覆盖；<C>--force</C> 跳过备份。</li>
              <li>依赖装进同一处（共享存储时也链接进同样的 Agent 目录，<C>../&lt;slug&gt;/SKILL.md</C> 两边都对得上）；已经装过的不动，循环依赖不会死循环，缺失的依赖给出警告。<C>--no-deps</C> 不装依赖。</li>
              <li>在 <C>SKILL.md</C> 末尾附一段说明：引用的技能在本机的相对路径、用完怎么 <C>ash feedback</C>。推送回库时这段会自动去掉，写在它后面的修改照常保留；<C>ASH_FEEDBACK_HINT=0</C> 可不附加。</li>
            </ul>
            <h3>状态</h3>
            <Table head={['状态', '含义', '怎么处理']} rows={[
              ['最新', '与服务端一致', '—'],
              ['有更新', '服务端有新的发布版本', <><C>ash pull --all</C> 或 <C>ash pull &lt;slug&gt;</C></>],
              ['本地有修改', '文件被改过（指纹不一致）', '值得保留就推送回库里；ash pull 会先备份再覆盖'],
              ['本地有修改 · 远端有更新', '两边都变了', 'pull --all 会跳过它，需单独处理'],
              ['远端已删除 / 在废纸篓', '服务端已经没有这个技能', <><C>ash remove &lt;slug&gt;</C></>],
              ['来自其它服务', '从另一个服务地址装的', '不参与本服务的比对'],
            ]} />
          </Section>

          <Section id="push-review" title="推送与审核">
            <h3>推送</h3>
            <CodeBlock>{'ash new my-skill               # 新技能：生成骨架（元技能加 --meta）\nash lint ./my-skill/            # 推送前自查，修到没有 ⚠️\nash push ./my-skill/            # 推送整个目录（推荐，含附属文件）\nash push ./my-skill/ --update   # 更新已有技能\nash push ./SKILL.md             # 只推送一个文件\nash push ./my-skill/ --folder Ops/Deploy   # 新技能放进指定文件夹'}</CodeBlock>
            <ul>
              <li>先 <C>ash suggest "&lt;新技能要解决的问题&gt;"</C> 查重。已有相近技能时，<C>ash pull</C> 下来在原版上改，再 <C>--update</C> 推送；部分步骤已经是别的技能（尤其元技能）的内容时，用 <C>depends_on</C> 引用它，不要复制。</li>
              <li>新技能不要从空白写起：<C>ash new &lt;slug&gt;</C> 生成符合规范的骨架（元技能加 <C>--meta</C>）；写完先 <C>ash lint &lt;目录&gt;</C> 自查（已在库里的技能也可以 <C>ash lint &lt;slug&gt;</C>），修到没有 ⚠️ 再推送。</li>
              <li>推送新技能时，服务端会比对库里名称、描述、标签和标题相近的技能，在推送结果里提示「库中已有相近技能」（相似度 40% 以上标为疑似重复）。</li>
              <li>不加 <C>--update</C> 时，同名 slug 已存在会被拒绝（409），不会覆盖已有版本；废纸篓里的同名技能要先在网页上恢复或彻底删除。</li>
              <li>内容没有变化的推送不会产生新版本。更新时名称、标签、所在文件夹保留网页上维护的值，只替换内容、描述和版本。</li>
            </ul>
            <h3>审核</h3>
            <ul>
              <li>推送的<strong>新技能</strong>状态为「待审核」：Agent 默认拉不到，推送者自己要用时加 <C>--pending</C>。</li>
              <li>对已发布技能的<strong>更新</strong>挂在原技能上等待审核，采纳前 Agent 拉到的仍是当前发布版本。</li>
              <li>在应用的「待审核」里查看内容、与当前版本的差异和安全提醒，然后采纳或拒绝。拒绝新技能会移入废纸篓（可恢复），拒绝更新直接丢弃。</li>
              <li>审核条会给出判断依据：新技能列出<strong>相似的已有技能</strong>（有没有必要单独成为一个技能），更新列出<strong>当前版本收到的失败反馈</strong>（这次更新在修什么）。</li>
              <li>推送者用 <C>ash mine</C> 查看结果，用 <C>ash withdraw</C> 撤回仍在待审的推送（只能撤回本机推送的）。</li>
              <li>服务端设置 <C>ASH_REQUIRE_REVIEW=0</C> 可以关闭审核，但命中高危规则的推送仍然强制待审。</li>
            </ul>
            <h3>使用情况与反馈</h3>
            <p>技能装到本地后由 Agent 直接读取，服务端看不到「使用」本身，所以靠这几种信号：安装（记下装到了哪台机器）、阅读（<C>ash show</C>）、反馈（<C>ash feedback</C>），以及装了 hook 的 Claude Code 上报的本地调用。通过 ash 安装的 SKILL.md 末尾会附一行提示，请 Agent 用完回报结果；推送回库时这一行会被自动去掉，写在它后面的修改照常保留。</p>
            <p>只靠提示，Agent 常常忘记回报，健康信号就不准。「需关注」视图顶部和 <C>ash stats</C> 会显示<strong>反馈率</strong>（反馈次数 ÷ 使用次数），以及哪些机器用过技能却从没回报。在跑 Claude Code 的机器上运行 <C>ash hooks install</C>：每轮结束时 hook 读一遍会话记录，把用到的 ash 技能记入库里；用了却没回报的，提醒 Agent 回报一次（每个技能每个会话只提醒一次，<C>ASH_HOOK_REMIND=0</C> 只记录不提醒）。hook 需要 node 或 python3：安装时用它改 settings.json、每轮结束用它解析会话记录；两者都没有时 <C>ash hooks install</C> 只给出手动配置说明，hook 本身也会安静跳过（不记录、不提醒）。</p>
            <p>反馈记在 Agent 本机所装的版本上：技能更新之后，旧版本收到的失败不再算在新版本头上。由此得出的健康信号：</p>
            <Table head={['信号', '含义']} rows={[
              ['常失败', '当前版本至少 2 次失败，且失败不少于成功'],
              ['疑似重复', '与另一个已发布技能的名称、描述、标签和标题高度相似（40% 以上）'],
              ['长期未用', '最近 60 天没有安装、阅读、Agent 调用或反馈'],
              ['从未使用', '发布 14 天以上从没有被安装、阅读、Agent 调用或反馈（从开始记录使用时算起）'],
            ]} />
            <p>这些技能汇总在应用的「需关注」视图里，按上面的顺序排列：先修常失败的，再合并重复的，最后清理不用的。详情页的「使用情况」列出最近的反馈和相似技能。</p>
            <h3>安全扫描</h3>
            <p>SKILL.md 和所有附属文件都会被扫描。结果随技能保存、在详情页显示，只提示不拦截；高危项强制进入人工审核。</p>
            <Table head={['规则', '级别']} rows={[
              [<><C>rm -rf</C> 指向根目录或家目录</>, '高危'],
              ['base64 / 十六进制混淆的 eval、exec', '高危'],
              ['疑似反弹 shell（nc -e、bash -i >& /dev/tcp 等）', '高危'],
              [<><C>curl … | sh</C> / <C>wget … | sh</C> 远程执行</>, '提醒'],
              ['疑似硬编码密钥（api_key、secret、token 等赋值长字符串）', '提醒'],
            ]} />
          </Section>

          <Section id="versions" title="版本历史">
            <ul>
              <li>每次内容发生变化（网页编辑、采纳更新、恢复版本）前，旧内容连同附属文件自动存为一个历史版本。</li>
              <li>在详情页的「历史版本」里可以和当前版本对比差异、恢复任意版本（恢复前会再备份一次当前内容），也可以给版本打标签，例如「v2 稳定版」。</li>
              <li>命令行只读：<C>ash versions &lt;slug&gt;</C> 列出历史，<C>ash show &lt;slug&gt; --version &lt;id&gt;</C> 查看其中一个。</li>
            </ul>
          </Section>

          <Section id="bundles" title="技能组合">
            <ul>
              <li>在应用侧栏的「技能组合」里新建组合，把技能加进去（拖拽或在列表里多选添加）。组合只是快捷方式，删除组合或移除成员不会影响技能本身。</li>
              <li>组合可以用数字 id、标识或名称引用，中文名的组合也能直接按名称安装。</li>
              <li>安装时只装已发布的成员，待审核的会被跳过并提示。</li>
            </ul>
            <CodeBlock>{'ash bundles\nash bundle 感知工具箱\nash pull bundle:感知工具箱'}</CodeBlock>
          </Section>

          <Section id="share" title="分享链接">
            <p>把一个已发布的技能发给库外的人，或同一个服务上的其他账号。对方打开链接就能看全部文件、下载 zip、一行命令装进自己的 Agent；登录了同一个服务的，还可以「存到我的库」复制一份。</p>
            <ul>
              <li><strong>一个技能可以有多条链接</strong>：每发给一个人建一条，各自写备注、设密码和有效期（1 天 / 7 天 / 30 天 / 永久），哪条不想要了单独停用，立即失效。</li>
              <li><strong>默认是快照</strong>：链接冻结创建时的版本，之后的修改和待审更新都不会出现在里面；勾选「始终最新」则跟随当前已发布版本。快照和最新之间不能切换，要换就新建一条。</li>
              <li><strong>密码</strong>：解锁前不透露技能名等任何信息；解锁后 24 小时内刷新、下载不用再输，复制出的安装命令也带着这 24 小时的凭据。连续输错会被限流。</li>
              <li><strong>失效</strong>：过期、停用、技能移进废纸篓（恢复后链接恢复）或被永久删除，链接一律显示「不存在」。待审核的技能不能分享。</li>
              <li><strong>管理</strong>：详情页工具栏的「分享」按钮管理这个技能的链接，侧栏的「我的分享」看全部；每条链接记录浏览和取用（下载、安装、存到库）次数，也计入技能的使用统计。</li>
              <li><strong>Agent 读链接</strong>：curl 或 Agent 抓取分享链接拿到的是 Markdown（附文件清单和安装命令），<C>?raw=1</C> 拿原文。</li>
            </ul>
            <CodeBlock>{'ash share systematic-debugging --label 给小王 --expires 30d\nash shares\nash unshare https://your-host/share/<token>\n\n# 收到链接的一方\nash pull https://your-host/share/<token>\ncurl -fsSL https://your-host/share/<token>/install.sh | bash'}</CodeBlock>
          </Section>

          <Section id="references" title="技能之间的引用">
            <p>一段操作已经有技能（尤其是元技能）负责时，引用它，而不是把步骤抄进来：抄过来的两份会漂移，一个坑就要修两处。</p>
            <h3>怎么写</h3>
            <ol>
              <li>frontmatter 的 <C>depends_on</C> 声明它：<C>ash pull</C> 据此把它一并装在本技能旁边。</li>
              <li>正文在用到它的地方写「用元技能 <C>&lt;slug&gt;</C>」，后面只写本技能特有的参数和坑；也可以写成相对链接 <C>../&lt;slug&gt;/SKILL.md</C>。不要写绝对路径。</li>
            </ol>
            <CodeBlock copy={false}>{'## 编译\n> 用元技能 `dev-container-build`\n> - target: `//app:main`\n> - **本技能特有**：必须加 `--build_tag_filters=sim`'}</CodeBlock>
            <Table head={['写法', '含义']} rows={[
              [<C>slug</C>, '本库里的技能'],
              [<C>@账号/slug</C>, '指定账号的技能。为团队库、技能广场预留，目前只能指向自己的账号，指向别人会提示'],
              [<C>slug@1.2.0</C>, <>固定版本：<C>ash pull</C> 从历史里装那一版，<C>ash pull --all</C> 不会升级它。版本号来自 frontmatter 的 <C>version</C>，改了内容要记得升版本号</>],
            ]} />
            <h3>本地 Agent 怎么找到被引用的技能</h3>
            <p>各家 Agent（Claude Code、Codex 等）的技能格式都没有「依赖」字段：它们看到的只是技能的名称、描述和正文，也只从各自的目录加载技能。所以引用要靠这几件事落地：</p>
            <ul>
              <li><strong>装在一起</strong>：<C>ash pull</C> 把 <C>depends_on</C> 里的技能装进同一处（共享存储时也链接进同样的 Agent 目录），<C>../&lt;slug&gt;/SKILL.md</C> 一定对得上。</li>
              <li><strong>告诉它在哪</strong>：已装的 <C>SKILL.md</C> 末尾会列出引用的技能及其相对路径，任何能读文件的 Agent 都能顺着找到（推送回库时这段会自动去掉）。</li>
              <li><strong>装对位置</strong>：Claude Code 只从 <C>~/.claude/skills</C> 和项目的 <C>.claude/skills</C> 加载技能，Codex 从 <C>~/.agents/skills</C>，Hermes 从 <C>~/.hermes/skills</C>。<C>ash pull</C> 默认装进共享存储并链接给本机每个 Agent 的目录（在 Claude Code 里运行时一定包括 <C>~/.claude/skills</C>）；要控制链接给谁用 <C>--agent</C>（或设置 <C>ASH_AGENT</C>），要直装某个目录用 <C>--dir</C>。</li>
              <li><strong>告诉 Agent 怎么用</strong>：遇到「用元技能 <C>x</C>」时，Claude Code 直接调用同名技能；其他 Agent 读 <C>../x/SKILL.md</C>；本机没有就 <C>ash pull x</C>。这条规则写在 <a href="/agent.md">/agent.md</a> 里，也写在已装技能末尾的说明里。</li>
              <li><strong>检查本机</strong>：<C>ash doctor</C> 逐个目录检查引用的技能在不在旁边、装的目录有没有 Agent 加载、被引用的技能能不能被调用；<C>ash doctor --fix</C> 自动补装缺的。</li>
              <li><strong>让它调用得到</strong>：被引用的技能不要设置 <C>disable-model-invocation: true</C>；<C>name</C> 与 slug 一致、只用小写字母数字和连字符；description 不超过 1024 个字符。<C>ash lint</C> 会检查。</li>
            </ul>
            <h3>元技能</h3>
            <p>元技能是被别的技能在流程中引用的基础动作：调用方只说「要做什么」，元技能负责「怎么做」。已经有 3 个以上技能在重复同一段操作、它与业务无关、输入输出说得清时才值得抽——第 1 次写在原地，第 2 次忍住，第 3 次才抽。写法：</p>
            <ul>
              <li>description 以「【元技能】」开头，写明「被其他技能引用」和「被直接要求」两种触发场景。</li>
              <li>正文必须有 <C>## 契约</C>（输入 / 输出 / 前置 / 失败）和 <C>## 被谁引用</C> 两节。</li>
              <li>不要加 <C>disable-model-invocation: true</C>，否则别的技能引用不到它。</li>
            </ul>
            <p>每多一层引用，Agent 就多读一个文件、多一个可能断的地方。引用链超过两层时检查会提醒；一小段、只有一两处用到的步骤，留在原地比抽出去好。</p>
            <h3>自动检查</h3>
            <p><C>ash lint [slug|目录]</C>、推送结果、网页详情页的「引用关系」和审核条都会给出同一套检查：</p>
            <Table head={['检查', '说明']} rows={[
              ['双语描述', '缺中文或英文描述'],
              ['引用写法', '写法不对、引用的技能不在库里或还在待审核、正文引用了却没写进 depends_on、用了绝对路径、固定的版本在历史里不存在'],
              ['能否被调用', 'frontmatter 解析失败、缺 description 或超过 1024 字符、name 与 slug 不一致或不符合规范、被引用的技能设置了 disable-model-invocation'],
              ['引用链', '超过两层，或引用成环'],
              ['元技能', '缺「## 契约」、缺「## 被谁引用」或与实际不符、调用方少于 2 个'],
              ['相同的步骤', <>两种比对：shell 代码块里的命令归一化后精确比对；编号列表、复选框里的文字步骤按词重合度模糊比对（措辞略有不同也算同一步）。与元技能有 3 条以上相同，提示改为引用；与另外 2 个以上技能相同，提示可以提炼元技能</>],
            ]} />
            <p>其中引用失效、抄了元技能步骤、可提炼元技能、元技能缺契约也会出现在「需关注」视图里。</p>
          </Section>

          <Section id="graph" title="依赖图">
            <p>应用侧栏的「依赖图」把技能之间的关系画成一张图。只认明确的信号，正文里随口提到某个技能名不算：</p>
            <ul>
              <li><strong>依赖</strong>：frontmatter 里声明的 <C>depends_on</C> 等字段。指向库里不存在的技能会标为未解析。</li>
              <li><strong>引用</strong>：正文里指向其他技能 <C>SKILL.md</C> 的相对链接（如 <C>../verification-discipline/SKILL.md</C>），以及同一行里既出现「元技能 / meta-skill」、又出现某个元技能完整 slug 的写法。代码块里的示例不算。</li>
              <li>图中只画出指向<strong>元技能</strong>的边。元技能的判定：frontmatter <C>type: meta</C>、标签含 <C>meta-skill</C> / <C>元技能</C>、描述以「【元技能】」开头，或放在名为「元技能」的文件夹里。单独的 <C>meta</C> 标签不算（它常指「关于技能本身」的技能）。</li>
            </ul>
          </Section>

          <Section id="web" title="网页端">
            <ul>
              <li><strong>三栏布局</strong>：文件夹 / 技能列表 / 详情，三栏宽度可拖动并会记住；侧栏和列表都可以折叠。</li>
              <li><strong>系统视图</strong>：收件箱（新技能默认放这里）、收藏、最近浏览、待审核、需关注、全部、废纸篓。待审核和需关注只在有内容时出现。</li>
              <li><strong>整理</strong>：拖拽技能到文件夹、收藏、多选批量操作、右键菜单；文件夹可以多级嵌套、重命名和删除（删除时里面的技能移回收件箱）。</li>
              <li><strong>编辑</strong>：新建技能、粘贴整份 SKILL.md 导入（实时预览识别出的 slug、标签和冲突），详情页里直接编辑名称、描述和 SKILL.md 正文（附属文件随推送更新）。</li>
              <li><strong>定位链接</strong>：地址栏的 <C>/app?skill=&lt;slug&gt;</C> 可以直接定位到某个技能（只对自己有效）；浏览器打开 <C>/s/&lt;slug&gt;</C> 也会跳到这里。详情页可以一键复制给 Agent 的指令。发给别人请用<a href="#share">分享链接</a>。</li>
              <li><strong>跨设备</strong>：上次浏览的位置按账号保存，换一台电脑登录会回到同一个技能。</li>
            </ul>
            <h3>快捷键</h3>
            <Table head={['按键', '作用']} rows={[
              [<><kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>K</kbd></>, '命令面板：全库检索、对当前技能执行操作'],
              [<kbd>?</kbd>, '快捷键速查'],
              [<kbd>/</kbd>, '聚焦搜索框'],
              [<kbd>N</kbd>, '新建技能'],
              [<><kbd>J</kbd> / <kbd>K</kbd>（或 ↓ / ↑）</>, '下一个 / 上一个技能'],
              [<><kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>A</kbd></>, '全选当前列表'],
              [<kbd>S</kbd>, '收藏 / 取消收藏'],
              [<kbd>E</kbd>, '编辑 / 预览切换'],
              [<><kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>S</kbd></>, '保存编辑'],
              [<><kbd>Delete</kbd> / <kbd>Backspace</kbd></>, '移入废纸篓'],
              [<kbd>Esc</kbd>, '清空搜索 / 取消多选 / 退出输入'],
            ]} />
          </Section>

          <Section id="agents" title="接入 Agent">
            <p>给 Agent 的引导语只有一句，真正的使用约定放在服务端的 <a href="/agent.md">/agent.md</a>（<C>ash guide</C> 输出同样内容）。修改约定时所有 Agent 自动生效，不用重发提示词。</p>
            <p>指南分两层：<a href="/agent.md">/agent.md</a> 是每次接入都读的精简版，只讲查找、使用、回报、推送；写技能、技能之间的引用、提炼元技能、HTTP 接口等放在 <a href="/agent-full.md">/agent-full.md</a>（<C>ash guide --full</C>），精简版会告诉 Agent 什么时候去读它。</p>
            <CodeBlock>{onboardingPrompt(origin)}</CodeBlock>
            <p>约定的要点：</p>
            <ul>
              <li>接到项目特定或不熟悉的任务时，先 <C>ash suggest "&lt;任务描述&gt;"</C>，中英文关键名词都写上；没有合适的就按常规方式做，不硬套。</li>
              <li>按技能完成（或没能完成）任务后，用 <C>ash feedback</C> 回报一次结果；失败时写一句哪一步、为什么。</li>
              <li>需要执行脚本的技能用 <C>ash pull</C> 安装后按 SKILL.md 执行；只读说明用 <C>ash show</C>。</li>
              <li>做完可复用的流程再推送；一次性记录、会话相关内容和任何密钥、口令、隐私都不推送。</li>
              <li>提示未登录时，Agent 应该请你运行 <C>ash login</C>，而不是自己去要或输入密码。</li>
            </ul>
          </Section>

          <Section id="http" title="HTTP 接口">
            <p>没有 ash 的环境可以直接调用接口。除了下面标为公开的几个，所有请求都要带 token：</p>
            <CodeBlock>{`curl -fsSL -H "Authorization: Bearer $ASH_TOKEN" ${origin}/s/<slug>/install.sh | bash`}</CodeBlock>
            <Table head={['请求', '说明']} rows={[
              [<C>GET /s/&lt;slug&gt;.md</C>, <>SKILL.md；多文件技能末尾附文件清单（<C>?raw=1</C> 取原文，<C>?version=&lt;id&gt;</C> 取历史版本）</>],
              [<C>GET /s/&lt;slug&gt;/info</C>, '技能信息、依赖与文件清单（纯文本）'],
              [<C>GET /s/&lt;slug&gt;/files/&lt;路径&gt;</C>, '单个附属文件'],
              [<C>GET /s/&lt;slug&gt;/versions</C>, '历史版本列表'],
              [<C>GET /s/&lt;slug&gt;/install.sh</C>, <>安装脚本；<C>?agent=</C> <C>?dir=</C> <C>?pending=1</C> <C>?force=1</C> <C>?nodeps=1</C></>],
              [<C>GET /s/&lt;slug&gt;/archive.tar.gz</C>, <>完整技能包（<C>/download</C> 为 zip）</>],
              [<C>GET /s/bundle/&lt;组合&gt;/install.sh</C>, '安装整个组合'],
              [<C>GET /api/skills?search=&amp;tag=&amp;folder=&amp;format=text</C>, '搜索与列表'],
              [<C>GET /api/bundles[/&lt;组合&gt;]?format=text</C>, '组合列表 / 成员'],
              [<C>POST /api/agent/push</C>, <>multipart：<C>file</C>（tar.gz 或 SKILL.md）、<C>update=1</C>、<C>folder</C>、<C>terminal</C>、<C>format=text</C></>],
              [<C>GET /api/agent/mine?terminal=</C>, '某个来源推送的技能及审核状态'],
              [<C>POST /api/agent/withdraw</C>, <>撤回待审推送：<C>slug</C>、<C>terminal</C></>],
              [<C>GET /api/agent/revisions?slug=a&amp;slug=b</C>, '已装技能比对：每行 slug、状态、修订号、版本'],
              [<C>POST /api/agent/used</C>, <>本机 Agent 用到了已装技能：<C>slug</C>（可重复）、<C>revision</C>、<C>terminal</C>。ash 的 Claude Code hook 调用它</>],
              [<C>GET /api/skills/insights?days=30&amp;format=text</C>, '使用次数、反馈率、按机器拆分（ash stats）'],
              [<>公开：<C>/setup.sh</C> <C>/cli.sh</C> <C>/agent.md</C> <C>/agent-full.md</C> <C>/llms.txt</C> <C>/healthz</C></>, '不需要 token'],
            ]} />
            <p>浏览器会话调用写接口时还必须带 <C>X-ASH-Request: 1</C> 请求头（防跨站伪造），用 token 调用不需要。</p>
          </Section>

          <Section id="self-host" title="自托管与配置">
            <h3>部署</h3>
            <CodeBlock>{'git clone https://github.com/Arismemo/AnotherSkillHub.git\ncd AnotherSkillHub\ndocker compose up -d --build     # 只监听 127.0.0.1:9444'}</CodeBlock>
            <p>不用 Docker：Node 22+，<C>npm install && npm --prefix client install && npm run build && npm start</C>。所有数据都在 <C>data/</C>（SQLite 数据库 + 技能文件目录），备份这个目录就备份了全部。</p>
            <p>对公网开放时放在反向代理（Nginx 等）后面，并传递 <C>X-Forwarded-For</C> 和 <C>X-Forwarded-Proto</C>：前者让登录限流按真实 IP 计数，后者让登录 cookie 带上 <C>Secure</C>。</p>
            <h3>服务端配置</h3>
            <Table head={['环境变量', '默认', '作用']} rows={[
              [<C>PORT</C>, '9444', 'HTTP 端口'],
              [<C>DATA_DIR</C>, <C>./data</C>, 'SQLite 数据库位置'],
              [<C>STORAGE_DIR</C>, <C>./data/skills_files</C>, <>技能文件目录（每个账号在 <C>@users/&lt;id&gt;/</C> 下）</>],
              [<C>ASH_REGISTRATION</C>, <C>open</C>, <><C>closed</C> 关闭自助注册</>],
              [<C>ASH_REQUIRE_REVIEW</C>, <C>1</C>, <><C>0</C> 关闭推送审核（高危命中仍需审核）</>],
              [<C>ASH_SEED</C>, <C>1</C>, <><C>0</C> 新账号不带示例技能</>],
              [<C>ASH_ALLOWED_EXTS</C>, '文本类', '附属文件扩展名白名单，逗号分隔'],
              [<C>ASH_TRUST_PROXY</C>, '本机与私网', <>哪些上游可以设置 <C>X-Forwarded-*</C></>],
              [<C>ASH_EMBED_URL</C>, '不设置', <>可选语义层：Ollama 地址（如 <C>http://127.0.0.1:11434</C>）或以 <C>/v1</C> 结尾的 OpenAI 兼容接口</>],
              [<C>ASH_EMBED_MODEL</C>, <C>bge-m3</C>, '向量模型（需多语言模型才能跨语言对上）'],
              [<C>ASH_EMBED_KEY</C>, '不设置', 'OpenAI 兼容接口的 API key'],
              [<><C>ASH_EMBED_PAIR_THRESHOLDS</C> / <C>ASH_EMBED_QUERY_THRESHOLDS</C></>, <><C>0.68,0.74</C> / <C>0.58,0.68</C></>, '换模型时重新校准：技能之间「相近、疑似重复」、任务描述对技能「可能相关、相关」的余弦阈值'],
            ]} />
            <h3>语义层（可选）</h3>
            <p>纯文本比对看不见「中英文写法不同」的同类技能：中文写的技能和英文写的技能没有一个共同的词。配置一个多语言向量模型后，服务端为每个技能的名称、描述和标题算一个向量（存在数据库里，内容不变不重算），用于：</p>
            <ul>
              <li><strong>查重</strong>：只对主语言不同的两个技能用语义分数补位。同语言的同系列技能（例如一组飞书技能）语义上很像却不是重复，仍按文本比对。</li>
              <li><strong>按任务找技能</strong>：相关度取文本、语义两者较高的，中文描述也能找到英文写的技能。</li>
            </ul>
            <p>推荐 Ollama + <C>bge-m3</C>（<C>ollama pull bge-m3</C>，约 1.2GB，CPU 即可）。不配置时一切照旧；模型服务不可用时自动退回文本比对。服务端运行在 Docker 里时，Ollama 地址写宿主机地址（如 <C>http://host.docker.internal:11434</C>）。</p>
            <h3>创建账号 / 认领旧数据</h3>
            <CodeBlock>{'npm run user:create -- <用户名> [--admin]\n# Docker：docker exec -it ash npm run user:create -- <用户名> --admin'}</CodeBlock>
            <p>从没有账号体系的旧版本升级时，旧数据会被迁移但不属于任何人（谁都看不到）。先用 <C>ASH_REGISTRATION=closed</C> 部署，再由管理员认领，文件会一并搬到该账号的目录：</p>
            <CodeBlock>{'npm run user:create -- <用户名> --admin --claim-legacy'}</CodeBlock>
            <p>对已存在的账号加 <C>--claim-legacy</C> 只做认领，不改密码；与该账号已有技能或组合同名时会中止并列出冲突。</p>
            <h3>重置密码</h3>
            <CodeBlock>{'npm run user:create -- <用户名> --reset-password'}</CodeBlock>
            <p>输入新密码后，该账号所有设备上的网页登录都会失效；它的 API token 不受影响，需要时让用户在「账户」里吊销。</p>
          </Section>

          <Section id="security" title="安全模型">
            <ul>
              <li>除首页、文档、登录注册页、<C>/setup.sh</C>、<C>/cli.sh</C>、<C>/agent.md</C> 外，所有内容都需要登录或 token；每个查询都限定在调用者自己的库里。</li>
              <li>密码用 scrypt 加密存储；会话 id 和 token 只存 SHA-256 哈希，数据库泄露也拿不到可用的凭证。</li>
              <li>网页会话是 <C>HttpOnly</C>、<C>SameSite=Lax</C> 的 cookie（https 下加 <C>Secure</C>）；写操作还要求同站请求头和 Origin，跨站页面无法冒用你的登录。</li>
              <li>生成的安装脚本里所有来自请求或数据库的值都以单引号字面量写入，参数无法注入命令；token 只在运行时读取，不写进脚本。</li>
              <li>附属文件路径不能越出技能目录，文件夹路径不能越出账号的存储目录。</li>
            </ul>
          </Section>

          <Section id="faq" title="常见问题">
            <dl className="doc-faq">
              <dt>ash 提示「尚未登录」或「token 无效或已吊销」</dt>
              <dd>运行 <C>ash login</C>。服务端升级到账号版本后，每台机器都要先 <C>ash update</C> 再登录一次。</dd>
              <dt>推送后别的机器拉不到</dt>
              <dd>新技能和更新都要在网页「待审核」里采纳。自己急用时 <C>ash pull &lt;slug&gt; --pending</C>。</dd>
              <dt>推送被拒绝：技能已存在（409）</dt>
              <dd>确认是在更新同一个技能就加 <C>--update</C>；是另一个技能就在 frontmatter 换一个 <C>name</C>。</dd>
              <dt>pull --all 跳过了某个技能</dt>
              <dd>它在本地被改过。值得保留就推送回库里；否则单独 <C>ash pull &lt;slug&gt;</C>，旧目录会备份到 <C>~/.ash/backups/</C>。</dd>
              <dt>附属文件没有上传</dt>
              <dd>超过大小限制或不在扩展名白名单里的文件会被跳过，推送结果里会列出它们，见 <a href="#skill-format">技能格式</a>。</dd>
              <dt>找不到以前的技能</dt>
              <dd>先看「废纸篓」；如果刚从旧版本升级，旧数据需要管理员认领，见 <a href="#self-host">自托管与配置</a>。</dd>
              <dt>登录一直失败</dt>
              <dd>连续失败 10 次会锁定 10 分钟。忘记密码请让管理员在服务器上重置，见 <a href="#self-host">自托管与配置</a>。</dd>
            </dl>
          </Section>
        </main>
      </div>

      <SiteFooter />
    </div>
  );
}
