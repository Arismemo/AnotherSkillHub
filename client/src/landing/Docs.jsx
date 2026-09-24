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
  { group: '技能', items: [['skill-format', '技能格式'], ['cli', 'ash 命令行'], ['local', '安装与本地管理'], ['push-review', '推送与审核'], ['versions', '版本历史'], ['bundles', '技能组合'], ['graph', '依赖图']] },
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
            <p className="lede">从第一次登录，到把整个团队的 Agent 接进来，再到自己部署和运维，所有用得到的知识都在这一页。</p>
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
                <CodeBlock>{'ash search 部署\nash info <slug>\nash pull <slug>'}</CodeBlock>
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
tags: [ops, debugging]
version: 1.0.0
depends_on: [other-skill]   # 可选，依赖的其他技能 slug
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
              ['tags', '数组或逗号分隔的字符串都可以'],
              ['version', <>默认 <C>1.0.0</C></>],
              ['依赖', <><C>depends_on</C>、<C>dependencies</C>、<C>requires</C> 或 <C>metadata.depends_on</C></>],
            ]} />
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
              <li>CLI 兼容 macOS 自带的 bash 3.2，只依赖 bash、curl、tar。</li>
            </ul>
            <h3>命令参考</h3>
            <Table head={['命令', '作用']} rows={[
              [<C>ash login [--token T]</C>, '登录；ash whoami 查看账号，ash logout 删除本机 token'],
              [<C>ash search &lt;关键词…&gt; [--tag T] [--folder F] [--json]</C>, '搜索已发布技能，多个关键词需同时命中（名称、slug、描述、正文）'],
              [<C>ash list [--tag T] [--folder F] [--json]</C>, '列出已发布技能'],
              [<C>ash info &lt;slug&gt;</C>, '描述、依赖（含缺失的依赖）、文件清单、版本、修订号和安装命令'],
              [<C>ash show &lt;slug&gt; [--version ID] [--pending]</C>, '直接输出 SKILL.md，不安装'],
              [<C>ash versions &lt;slug&gt;</C>, '历史版本列表'],
              [<C>ash pull &lt;slug&gt; [选项]</C>, <>安装技能及其依赖。选项：<C>--agent claude|codex|hermes|dsh</C>、<C>--dir PATH</C>、<C>--pending</C>、<C>--force</C>、<C>--no-deps</C></>],
              [<C>ash pull bundle:&lt;标识或名称&gt;</C>, '安装整个技能组合'],
              [<C>ash pull --all [--dir PATH] [--force]</C>, '更新所有过期的已装技能（本地改过的跳过，除非 --force）'],
              [<><C>ash installed</C> / <C>ash outdated</C></>, '本机已装技能及状态 / 只列需要处理的'],
              [<C>ash remove &lt;slug&gt; [--force]</C>, '卸载；本地改过的先备份'],
              [<><C>ash bundles</C> / <C>ash bundle &lt;标识或名称&gt;</C></>, '列出组合 / 查看组合成员'],
              [<C>ash push &lt;目录|SKILL.md&gt; [--update] [--folder PATH]</C>, '推送技能；同名已存在时必须加 --update'],
              [<C>ash mine</C>, '本机推送过的技能及审核结果'],
              [<C>ash withdraw &lt;slug&gt;</C>, '撤回自己仍在待审核的推送'],
              [<C>ash guide</C>, '输出 Agent 使用指南'],
              [<C>ash open</C>, '在浏览器打开应用'],
              [<C>ash update</C>, '更新 ash 自身'],
            ]} />
            <h3>环境变量</h3>
            <Table head={['变量', '作用']} rows={[
              [<C>ASH_SERVER_URL</C>, '服务地址（默认是安装时的地址）'],
              [<C>ASH_TOKEN</C>, <>API token，优先于 <C>~/.ash/token</C></>],
              [<C>ASH_SKILLS_DIR</C>, '默认安装目录'],
              [<C>ASH_TERMINAL</C>, '推送时记录的来源名，默认是主机名；ash mine / withdraw 按它识别「本机的推送」'],
              [<C>ASH_BIN_DIR</C>, 'ash 自身的安装位置'],
            ]} />
          </Section>

          <Section id="local" title="安装与本地管理">
            <h3>装到哪里</h3>
            <p>默认自动探测：<C>$ASH_SKILLS_DIR</C> → 唯一的 <C>~/.hermes/profiles/*/skills</C> → <C>~/.hermes/skills</C> → <C>~/.agents/skills</C> → <C>~/.claude/skills</C> → <C>~/.dsh/skills</C>，都不存在时用 <C>~/.agents/skills</C>。<C>--agent</C> 指定 Agent 的标准目录，<C>--dir</C> 指定任意目录。</p>
            <h3>安装做了什么</h3>
            <ul>
              <li>下载完整技能包，先解压到同级的临时目录，成功后整体替换，所以上游删掉的文件本地也会消失。</li>
              <li>在技能目录里写一个 <C>.ash</C> 文件，记录来源服务、修订号、版本和内容指纹。<strong>不要编辑或删除它</strong>，推送时会自动排除。</li>
              <li>同名目录本地改过、或不是 ash 装的，会先备份到 <C>~/.ash/backups/</C> 再覆盖；<C>--force</C> 跳过备份。</li>
              <li>依赖装到同一个目录；已经装过的不动，循环依赖不会死循环，缺失的依赖给出警告。<C>--no-deps</C> 不装依赖。</li>
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
            <CodeBlock>{'ash push ./my-skill/            # 推送整个目录（推荐，含附属文件）\nash push ./my-skill/ --update   # 更新已有技能\nash push ./SKILL.md             # 只推送一个文件\nash push ./my-skill/ --folder Ops/Deploy   # 新技能放进指定文件夹'}</CodeBlock>
            <ul>
              <li>先 <C>ash search</C> 查重。已有相近技能时，<C>ash pull</C> 下来在原版上改，再 <C>--update</C> 推送。</li>
              <li>不加 <C>--update</C> 时，同名 slug 已存在会被拒绝（409），不会覆盖已有版本；废纸篓里的同名技能要先在网页上恢复或彻底删除。</li>
              <li>内容没有变化的推送不会产生新版本。更新时名称、标签、所在文件夹保留网页上维护的值，只替换内容、描述和版本。</li>
            </ul>
            <h3>审核</h3>
            <ul>
              <li>推送的<strong>新技能</strong>状态为「待审核」：Agent 默认拉不到，推送者自己要用时加 <C>--pending</C>。</li>
              <li>对已发布技能的<strong>更新</strong>挂在原技能上等待审核，采纳前 Agent 拉到的仍是当前发布版本。</li>
              <li>在应用的「待审核」里查看内容、与当前版本的差异和安全提醒，然后采纳或拒绝。拒绝新技能会移入废纸篓（可恢复），拒绝更新直接丢弃。</li>
              <li>推送者用 <C>ash mine</C> 查看结果，用 <C>ash withdraw</C> 撤回仍在待审的推送（只能撤回本机推送的）。</li>
              <li>服务端设置 <C>ASH_REQUIRE_REVIEW=0</C> 可以关闭审核，但命中高危规则的推送仍然强制待审。</li>
            </ul>
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

          <Section id="graph" title="依赖图">
            <p>应用侧栏的「依赖图」把技能之间的关系画成一张图。只认明确的信号，正文里随口提到某个技能名不算：</p>
            <ul>
              <li><strong>依赖</strong>：frontmatter 里声明的 <C>depends_on</C> 等字段。指向库里不存在的技能会标为未解析。</li>
              <li><strong>引用</strong>：正文里指向其他技能 <C>SKILL.md</C> 的相对链接（如 <C>../verification-discipline/SKILL.md</C>），以及同一行里既出现「元技能 / meta-skill」、又出现某个元技能完整 slug 的写法。代码块里的示例不算。</li>
              <li>图中只画出指向<strong>元技能</strong>的边。元技能的判定：frontmatter <C>type: meta</C>、标签含 <C>meta</C> / <C>meta-skill</C> / <C>元技能</C>、描述以「【元技能】」开头，或放在名为「元技能」的文件夹里。</li>
            </ul>
          </Section>

          <Section id="web" title="网页端">
            <ul>
              <li><strong>三栏布局</strong>：文件夹 / 技能列表 / 详情，三栏宽度可拖动并会记住；侧栏和列表都可以折叠。</li>
              <li><strong>系统视图</strong>：收件箱（新技能默认放这里）、收藏、最近浏览、待审核、全部、废纸篓。</li>
              <li><strong>整理</strong>：拖拽技能到文件夹、收藏、多选批量操作、右键菜单；文件夹可以多级嵌套、重命名和删除（删除时里面的技能移回收件箱）。</li>
              <li><strong>编辑</strong>：新建技能、粘贴整份 SKILL.md 导入（实时预览识别出的 slug、标签和冲突），详情页里直接编辑名称、描述和 SKILL.md 正文（附属文件随推送更新）。</li>
              <li><strong>分享</strong>：地址栏的 <C>/app?skill=&lt;slug&gt;</C> 可以直接定位到某个技能；浏览器打开 <C>/s/&lt;slug&gt;</C> 也会跳到这里。详情页可以一键复制给 Agent 的指令。</li>
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
            <CodeBlock>{onboardingPrompt(origin)}</CodeBlock>
            <p>约定的要点：</p>
            <ul>
              <li>接到项目特定或不熟悉的任务时，先 <C>ash search</C>，中英文同义词都试；搜不到就按常规方式做，不硬套。</li>
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
              [<>公开：<C>/setup.sh</C> <C>/cli.sh</C> <C>/agent.md</C> <C>/llms.txt</C> <C>/healthz</C></>, '不需要 token'],
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
            ]} />
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
