# 信息密度与布局 审查

审查对象：`client`
方法：通读 `src/index.css`(570 行) + `src/App.jsx` + `src/components/*.jsx`；起 `node server/index.js`(9444) + `vite`(5197，临时 config 挂 `/api`、`/s` 代理)，用 claude-in-chrome 在真实 1440 视口截图 + `getBoundingClientRect` 量测。
**1920 说明【待确认→已折算】**：本机物理屏仅 1512 逻辑宽，`resize_window(1920,1080)` 被系统钳到 1440，无法真机截图；改用「注入 `html{zoom:.7}` + 放大 `.app-shell`」做等比模拟观察（见下），并按 CSS 规则精确折算 1920 下的列宽。1920 数字标注为【推算】。

---

## 现状摘要（含 1440 / 1920 下的空间利用观察）

三栏由单条 grid 规则定死（`index.css:108`）：

```css
grid-template-columns: clamp(11.5rem,14vw,13.5rem) clamp(15.5rem,19vw,18rem) minmax(0,1fr);
```

**1440×900 实测**（视口 1440×813，数据来自浏览器量测）：

| 区域 | 宽 | 说明 |
|---|---|---|
| 侧栏 `.app-sidebar` | 202px | `14vw`，顶部 68px 品牌条 + 92px 三按钮 = 160px 固定开销 |
| 列表 `.app-list` | 274px | 工具栏 97px；可滚动区 716px |
| 详情 `.app-detail` | 965px | — |
| └ `.detail-content` | **640px** | 左右各 **162px** 纯空白，详情区利用率 **66%** |
| 大纲 `.doc-outline` | **不出现** | 阈值 1180px，965 < 1180 |
| 列表一屏行数 | **6.7 行** | 行高 107px（title 19 + desc 35 + footer 27 + padding 13） |

**1920×1080【推算】**：`14vw=268.8 > 13.5rem` → 侧栏钳在 **216px**；`19vw=364.8 > 18rem` → 列表钳在 **288px**；详情得到 **1416px**，但 `.detail-content` 仍是 **640px** → 左右各 **388px** 空白，详情区利用率跌到 **45%**。大纲此时才出现（1416 ≥ 1180），占右侧 240px，但正文仍居中，正文右缘到大纲之间还剩 **130px** 空隙，左侧 388px 全空。一屏列表行数约 8.5 行。

**模拟观察佐证**：把 `.app-shell` 撑到 2057px 并 `zoom:.7` 后，`.detail-scroll` 1553px、`.detail-content` 仍是 640px，左右空白 913px（59%）——**屏幕越宽，浪费越多，这是当前布局的结构性行为，不是调参问题**。

一句话结论：**整个 App 只有「详情内的技能文件栏」一个可拖宽面板（`SkillDetail.jsx:647`），三栏主骨架既不可拖、也不记忆宽度；详情正文被 40rem 死锁，宽屏增益 100% 变成留白；列表行按移动端卡片的节奏排版，一屏只看得到 6~8 条。**

---

## 发现（按影响排序）

### 1. `.detail-content` 硬锁 40rem，宽屏所有增益变成死留白

- 位置：`client/src/index.css:265`（`width: min(100% - 2.5rem, 40rem); margin: 0 auto`），注释在 `index.css:282`
- 问题：注释写明「40rem 对齐 Anthropic 文章正文列」——那是**面向公众的长文阅读**取值。本工具是单人桌面工作台，正文里大量是命令行、脚本、表格、check list，不是散文。实测 1440 下浪费 325px（34%），1920 下浪费 776px（55%）。截图里 `./scripts/run_worldsim_minimal.sh --scenario ...` 这行在 640px 列里被横向裁断、出现横向滚动条，**而右边 325px 是纯黑空白**。
- 建议：
  1. 把死值换成随容器伸缩的软上限：`width: min(100% - 3rem, clamp(40rem, 62%, 68rem))`；
  2. 更彻底：加「舒适 / 宽屏」正文宽度开关（`localStorage: ash:content-width`），复用已有的 `usePersistedState` 模式（`App.jsx:22`）；
  3. 让宽内容 breakout —— `pre`、`table`、`.frontmatter-table` 用 `width: min(100%, var(--wide, 72rem)); margin-inline: calc(50% - min(50%, var(--wide)/2))`，正文保持窄、代码/表格吃满。
- 影响：高　工作量：小（1 和 3），中（2）

### 2. 文档大纲在 1440 屏上永远不出现（阈值 + 媒体查询双重死代码）

- 位置：`client/src/components/SkillDetail.jsx:271`（`setOutlineFits(w >= 1180)`），配套 CSS `index.css:313`、`index.css:559-562`
- 问题：`w` 是 `.detail-scroll` 的宽度，不是视口宽。`detail = 视口 - 侧栏 - 列表`：1440→965、1600→1096，都 < 1180；要到视口 **≈1684px** 才达标。实测 1440 下 `document.querySelector('.doc-outline')` 返回 `null` 已确认。更糟的是 `index.css:559-562` 的 `@media (min-width:1101px) and (max-width:1400px) { .doc-outline { width: 12.5rem } }` —— 该区间 `detail` 最大也才 938px，**这段规则 100% 永远不生效**。
- 建议：阈值降到 `w >= 860`，并让大纲在 860~1180 区间收窄成 `10rem`（把 559 行那段媒体查询改成基于容器宽的类名，如 `.detail-scroll.outline-narrow`）；或直接把大纲从 `position: fixed` 浮层改成 detail 内的第三列 grid 轨道，宽屏常驻、窄屏折叠成图标。
- 影响：高　工作量：小

### 3. 三栏主骨架不可拖宽、不记忆宽度（唯一可拖的是详情内文件栏）

- 位置：`client/src/index.css:108`（grid 死值）；对比 `SkillDetail.jsx:647-659` 已有完整的 resizer 实现（`role="separator"` + 键盘 ←/→ + 双击复位 + `localStorage: ash:file-sidebar-width`，见 `SkillDetail.jsx:279`）
- 问题：轮子已经造好了，却只用在最次要的一栏。主三栏的相对重要性因场景而异（整理文件夹时想要宽侧栏，批量筛选时想要宽列表），用户完全无法调。
- 建议：把 `.file-sidebar-resizer` 的 `startResize`/`onMove` 逻辑提成 `useResizableWidth(key, {min, max, initial})` hook，在 `App.jsx` 的侧栏与列表右缘各插一条；`.app-shell` 改为
  `grid-template-columns: var(--w-sidebar,13rem) var(--w-list,18rem) minmax(0,1fr)`，宽度写进 `usePersistedState('sidebar-width'/'list-width')`。双击 resizer 复位默认值。
- 影响：高　工作量：中

### 4. 列表行 107px，没有紧凑模式，一屏只装 6~8 条

- 位置：`client/src/index.css:220`（`.skill-row` padding `.42rem .6rem .38rem`）、`:226`（title `line-height:1.4`）、`:233`（描述 `-webkit-line-clamp:2`、`line-height:1.55`）、`:234`（footer `min-height:1.15rem`）
- 问题：实测拆解 = 标题 19 + 描述 35 + footer 27 + padding 13 + border 2 + 间距 ≈ 107px。对一个「管技能的工作台」，一屏 6 条意味着 20 个技能就要滚 3 屏。
- 建议：加三档密度开关（`localStorage: ash:list-density`）挂在 `.skill-list-panel` 上：
  - `compact`：描述 `-webkit-line-clamp:1`、`line-height:1.4`，padding 收到 `.3rem .55rem` → 约 **72px**；
  - `dense`：描述整行不显示，改为单行 `name · folder · date` → 约 **34px**（一屏 20+ 行）。
  注意同步改 `contain-intrinsic-size: auto 4.2rem`（`index.css:220`），否则 `content-visibility` 的占位高度会算错、滚动条乱跳。
- 影响：高　工作量：中

### 5. 技能卡片藏了一半已到手的元数据

- 位置：`client/src/components/SkillList.jsx:174-177`（只渲染 `description` / `folder_path` / `updated_at`）
- 问题：`GET /api/skills?folder=all` 的返回里**已经包含** `tags`、`version`、`terminal_source`、`created_at`、甚至完整 `content`（实测 payload keys：`['content','created_at','description','folder_path','id','is_deleted','is_starred','name','slug','tags','terminal_source','updated_at','version']`）。这些字段 0 额外请求成本，却一个都没显示。用户要知道「这技能打了什么标签 / 是哪个版本 / 从哪台终端来的」只能点进详情。
- 建议：footer 行补 `version` 徽标 + 最多 2 个 tag chip（复用 `.skill-summary span` 的 `#tag` 样式，`index.css:327`）+ `terminal_source`（用 `.palette-badge` 样式，`index.css:420`）；`slug` 放 `title` 属性。紧凑档下这些降级成一个 `⋯` 悬浮气泡。另外 `content` 既然白送，搜索时可以直接在行内渲染命中片段（高亮关键词），不用额外接口。
- 影响：高　工作量：小

### 6. 详情页头部 68px 高，中间一大段横向空白什么也不放

- 位置：`client/src/index.css:267`（`.detail-toolbar { min-height: 4.25rem }`）、`client/src/components/SkillDetail.jsx:560-595`
- 问题：左边只有一行 `.65rem` 面包屑 + 一行 `.95rem` 标题（`index.css:269/271`），右边 5 个操作控件，1440 下中间约 400px、1920 下约 850px 完全空置。而标题本身在列表里已被选中高亮，属于重复信息（见发现 14）。
- 建议：头部压到 `min-height: 3rem`，面包屑与标题同一行（面包屑在前、标题跟随、`min-width:0` + ellipsis）；空出来的中段放**只读状态条**：`version` / 更新时间（相对时间，如「3 天前」）/ 文件数 / 包体积 / `terminal_source`。这些正是用户「一眼要看见」的技能身份信息。
- 影响：高　工作量：中

### 7. 空状态用掉整块 965×745 详情区放三行字

- 位置：`client/src/index.css:141`（`.detail-empty { display:grid; place-content:center; height:100% }`）、`client/src/App.jsx:461-470`
- 问题：实测截图（切到没有选中项的视图）：965×745 的区域里只有「选择一个技能查看详情 / 技能内容、关联文件和操作会显示在这里。/ 两个按钮」。这是整屏里最大的一块，却零信息量。
- 建议：空态改成「工作台首页」：最近浏览（`App.jsx:333` 的 `recentSkills` 已算好）、收藏的技能、各文件夹计数（`stats` 已在 `App.jsx:50`）、终端接入命令卡片（`AgentSetupModal` 的内容可平铺一份）。保留新建/粘贴导入按钮作为次级操作。同理 `.list-state`（`index.css:240`，`min-height:15rem`）在列表为空时也留了一大片。
- 影响：高　工作量：中

### 8. 侧栏折叠后导航全部消失，且不给正文让出任何有效宽度

- 位置：`client/src/App.jsx:394`（`{!sidebarCollapsed && <FolderTree ... />}` 整棵树被卸载）、`client/src/index.css:114`（折叠后首列 `2.6rem`）、`:121`
- 问题：折叠态是一条 42px 的纯空白竖条，只有一个展开箭头——既看不到收件箱/收藏/废纸篓计数，也点不到任何文件夹，折叠 = 断网。而且省下的 160px 全部灌进详情区的**留白**（因为发现 1 的 640px 锁死），正文一个像素都没变宽。
- 建议：折叠态保留 `icon-only` 导航（把 `navItems`，`FolderTree.jsx:18-23`，渲染成 2.6rem 宽的图标按钮列，计数做成右上角小圆点），hover 展开浮层显示文件夹树；配合发现 1 后折叠才真正有收益。
- 影响：中　工作量：中

### 9. 中栏（技能列表）无法折叠 —— CSS 里留了承诺、没有实现

- 位置：`client/src/index.css:125` 的注释 `/* 中栏（技能列表）折叠成细条：grid 列同步收窄 */`，其下没有任何规则；全仓 `grep is-collapsed` 只有 `.app-sidebar`（`App.jsx:361`、`index.css:114/121`）
- 问题：专注读一篇长 SKILL.md 时，274px 的列表是纯干扰，但没有任何办法收起它。
- 建议：给 `.app-list` 加 `is-collapsed`，配 `.app-shell:has(.app-list.is-collapsed) { grid-template-columns: ... 2.4rem minmax(0,1fr) }`，细条上竖排显示「列表 · N」（直接复用已有的 `.file-sidebar-rail` 样式，`index.css:254-257`，它已经做过一模一样的竖排计数细条）。状态存 `usePersistedState('list-collapsed')`。顺手把死注释删掉。
- 影响：中　工作量：小

### 10. 列表工具栏占两行 97px，排序能力却只有一个二态按钮

- 位置：`client/src/index.css:208`（`.list-toolbar` padding `.85rem .8rem .7rem`）、`:211`（搜索框 `height:2.15rem`）、`:214`（`.list-heading-row { margin-top:.75rem }`）；`client/src/components/SkillList.jsx:91-99`
- 问题：实测 97px。「搜索框」一行 + 「标题 + 计数 + 排序」一行。而排序只能在 `updated ↔ name` 之间来回切（`SkillList.jsx:94`），没有升降序、没有按创建时间/大小排、没有筛选 chips（收藏/有标签/某终端来源）。信息密度低、能力也低。
- 建议：合成一行：搜索框 `flex:1` + 计数贴在标题旁 + 排序改 `FolderPicker`（组件已支持 `options` 模式，见 `FolderTree.jsx:306`）下拉 + 一个方向箭头 icon-button。工具栏高度可从 97px → 约 44px。筛选 chips 放在搜索框获得焦点或有激活筛选时才出现的第二行。
- 影响：中　工作量：中

### 11. Markdown 正文按「博客文章」排版，不是「工程文档」

- 位置：`client/src/index.css:329`（`font-size:.9rem` = 14.4px，`line-height:1.8`）、`:333`（h2 `margin: 2rem 0 .75rem`）、`:335`（段落 `margin:.72rem 0`）、`:337`（`li + li { margin-top:.28rem }`）、`:342`（`pre { padding:1rem; line-height:1.65 }`）
- 问题：实测 `line-height` 计算值 25.92px、h2 上边距 32px。SKILL.md 典型内容是「短小节 + 命令块 + check list」，1.8 行高让一屏只装下 2~3 个小节（截图里 1440×813 一屏只看到「核心说明」「1. 常用启动命令」「2. 关键自验标准」三节的开头）。
- 建议：正文 `line-height: 1.65`；`h2 { margin-top: 1.4rem }`、`h3 { margin-top: 1.05rem }`；`li + li { margin-top: .15rem }`；`pre { padding: .7rem .85rem; line-height: 1.5 }`。粗估同屏内容量 +20~25%。与发现 4 一样做成密度开关最稳。
- 影响：中　工作量：小

### 12. 侧栏顶部 160px 固定开销，三个按钮占了两行

- 位置：`client/src/index.css:117`（`.sidebar-topbar { min-height: 4.25rem }`）、`:166-170`（`.sidebar-actions` 两列 grid，`button:last-child { grid-column: 1 / -1 }` → 「终端接入」独占一行）
- 问题：实测 topbar 68px + actions 92px = 160px，占 813px 视口的 **20%**，之后才轮到真正的导航。品牌区里的「AnotherSkillHub / Agent 技能库」副标题（`index.css:120`）对单人本地工具零价值。
- 建议：topbar 压到 `2.6rem`，去掉副标题 `p`（或移到 hover title）；`.sidebar-actions` 改三列等宽图标按钮（`+` / 粘贴 / 终端），或干脆只留「新建」，另两个收进 ⌘K 命令面板（`CommandPalette.jsx` 已注册 `onPasteImport` / `onOpenSetup`，见 `App.jsx:482-483`）。可回收约 110px ≈ 3 个导航项或 1.5 个技能行。
- 影响：中　工作量：小

### 13. 宽屏下列表不能多列，详情不能分栏

- 位置：`client/src/index.css:219`（`.skill-list-scroll` 单纵列）、`client/src/App.jsx:418-444`（`.app-list` 固定单列）
- 问题：1920【推算】下列表被钳死在 288px 单列，同时详情有 388px×2 的空白。宽屏的额外像素既没给列表、也没给正文。
- 建议：两条路，择一：
  - A（轻）：`.app-list` 宽度可拖（发现 3），拖过 `560px` 时 `.skill-list-scroll` 自动切 `grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr))` 双列卡片；
  - B（重）：详情区做「正文 + 侧栏」双轨 grid，右轨在宽屏常驻放大纲 + 元数据 + 文件树（把现在 `position:fixed` 的大纲和左侧的 `.file-sidebar` 统一进去）。
  推荐先做 A（成本小、直接吃掉宽屏红利），B 作为后续。
- 影响：中　工作量：A 小 / B 大

### 14. 描述与标题在「列表行 → 摘要块 → 头部标题」重复三次

- 位置：`client/src/index.css:324`（`.skill-summary` 实测 640×73px）、`client/src/components/SkillDetail.jsx:730-735`；重复源在 `SkillList.jsx:174`（描述）与 `SkillDetail.jsx:572`（标题）
- 问题：选中行已经高亮显示了 name + description，详情头部再写一次 name，正文顶部的 `.skill-summary` 再写一次 description（73px）。首屏最贵的位置在做三重复读。
- 建议：`.skill-summary` 只保留 tags 一行（把 tags 变成可点筛选，回填 `onSelectTag`），描述并入发现 6 的头部状态条；省出的 73px 让首屏多露出一个小节。
- 影响：中　工作量：小

### 15. 编辑模式的 textarea 固定 24 行，撑不满可用高度

- 位置：`client/src/components/SkillDetail.jsx:773`（`rows={24}`）、`client/src/index.css:372`（`resize: vertical`）
- 问题：实测编辑态下 textarea 底部在 y≈705，视口 822，下方约 115px 空白；换更高的屏空白更大。而且 `.editor-fields` 是两列（`index.css:368`），在 640px 宽里两个输入框各 ~310px，够用但下方的 SKILL.md 区却浪费高度。
- 建议：`.skill-editor` 改 `display:grid; grid-template-rows: auto 1fr auto; height:100%`，textarea 去掉 `rows`、设 `height:100%; min-height:20rem`，配合 `.detail-scroll` 在编辑态关掉滚动，让编辑器自己吃满高度。
- 影响：中　工作量：小

### 16. 技能文件栏的 CSS 宽度被 inline style 完全覆盖，响应式规则是死的

- 位置：`client/src/index.css:258`（`.file-sidebar { width: 15rem }`）与 `client/src/index.css:556`（`@media (max-width:1300px) { .file-sidebar { width: 12rem } }`）vs `client/src/components/SkillDetail.jsx:615`（`style={{ width: fileSidebarWidth }}`）
- 问题：inline style 优先级高于普通样式表，`15rem` 默认值和 `12rem` 窄屏收窄规则**从来不生效**，实际永远用 `localStorage` 里的数值（默认 240，见 `SkillDetail.jsx:250`）。窄屏收窄的意图失效。
- 建议：改成 CSS 变量传递：`style={{ '--file-sidebar-w': fileSidebarWidth + 'px' }}`，CSS 写 `width: min(var(--file-sidebar-w, 15rem), 40%)`，窄屏媒体查询改成调 `max-width`，意图才真正落地。顺带：`fileTree.length > 1` 才渲染（`SkillDetail.jsx:602/614`），单文件技能永远看不到文件区——本机 6 个技能全是单文件，该栏实际上从未出现过。
- 影响：中　工作量：小

### 17. 1300px 断点造成列宽「反向跳变」

- 位置：`client/src/index.css:548-549`（`@media (max-width:1300px) { .app-shell { grid-template-columns: 12.5rem 18rem minmax(0,1fr) } }`）vs `:108` 的 clamp
- 问题：视口 1301px 时，clamp 算出 侧栏 184px（触下界）、列表 248px（触下界）；掉到 1300px 反而变成 200px / 288px。**窗口缩小 1px，两栏各自变宽**，详情区骤缩 56px，大纲/文件栏的阈值判断也跟着跳。
- 建议：删掉这条 `grid-template-columns` 覆盖，让 clamp 单一负责列宽（clamp 的下界已经足够窄）；`@media (max-width:1300px)` 里只保留 `.detail-toolbar` 竖排、`.compact-action` 收字那几条真正需要的规则。
- 影响：低　工作量：小

### 18. 一批与布局相关的死 CSS，会误导后续改动

- 位置（均在 `client/src/index.css`，对应 class 在 `src/**/*.jsx` 里 grep 命中数为 0）：
  - `:264` 与 `:561` 的 `--outline-channel` ——**定义了两次，全仓无人读取**
  - `:266` `.detail-scroll.has-outline .detail-content { width: min(100% - 2.5rem, 40rem); margin: auto }` —— 与 `:265` 的基础规则**逐字相同**，纯空转；`:555` 又原样复制了一遍
  - `:289-297` `.attachment-strip` / `.attachment-list`（`.attachment-heading` 仍在用，`SkillDetail.jsx:616`）
  - `:477-484` `.editor-toolbar` / `.live-preview-toggle` / `.editor-split` / `.skill-editor.with-preview` / `.editor-preview` —— 整套「编辑分栏实时预览」样式存在，JSX 里没有任何对应结构
  - `:559-562` 整段媒体查询（见发现 2）
- 问题：下一个人看到 `.editor-split` / `--outline-channel` 会以为「分栏预览已实现、只差开关」或「正文右侧已预留通道」，按错误前提改布局。
- 建议：删；或者把 `.editor-split` 那套真正接上（正好呼应发现 13-B 的分栏思路）。删除前用 `grep -rn "<class>" src --include="*.jsx"` 复核一遍。
- 影响：低　工作量：小

### 19. 列表标题强制单行截断，宽度却不可调

- 位置：`client/src/index.css:226`（`.skill-row-title h3 { white-space: nowrap; text-overflow: ellipsis }`）
- 问题：274px 列里，「Systematic Debugging 4步根因排查法」被截成「Systematic Debugging 4步根…」、「ego-browser 浏览器自动化与评测」截成「…自动化与…」（截图实测）。技能名恰恰是最需要一眼认出的字段，而右侧详情区有 325px 空白。
- 建议：标题放开到 2 行（`-webkit-line-clamp: 2`），描述相应降到 1 行——总高度不变、可读性反升；紧凑档才退回单行。配合发现 3（列宽可拖）根治。
- 影响：低　工作量：小

### 20. `overflow:hidden` + `min-width:56rem` 在窄于 896px 时直接裁切内容

- 位置：`client/src/index.css:48-55`（`html,body,#root { overflow: hidden }`）、`:111`（`.app-shell { min-width: 56rem }`）
- 问题：窗口窄于 896px 时，`.app-shell` 溢出但祖先 `overflow:hidden`，**既不出现横向滚动条、内容也回不来**，右侧详情被永久裁掉。桌面单人场景优先级低，但分屏（左右各半屏 = 720px）是真实会发生的。
- 建议：`html,body` 保持 hidden，给 `#root` 加 `overflow-x: auto`；或在 `< 56rem` 时让 `.app-list` 与 `.app-sidebar` 自动进入折叠态（配合发现 8/9）。
- 影响：低　工作量：小

---

## 建议的实施顺序

**第 1 批 —— 纯 CSS 常量微调，当天可完成、收益立竿见影**

1. 发现 1（正文宽度改软上限 + 代码/表格 breakout）—— 单条规则，一次性拿回 33%~55% 的详情区
2. 发现 2（大纲阈值 1180 → 860）—— 一个数字，让 1440 屏首次看到大纲
3. 发现 11（正文行高/边距收紧）+ 发现 12（侧栏顶部瘦身）—— 同屏内容 +20%
4. 发现 5（卡片补 tags / version / 来源）—— 零新接口，直接补渲染
5. 发现 17（删 1300 断点的列宽覆盖）+ 发现 18（清死 CSS）—— 先把地基理干净，避免后面改动踩空转规则

**第 2 批 —— 结构性改动，需要新 state 与持久化**

6. 发现 3（三栏可拖宽 + 记忆宽度，抽 `useResizableWidth` hook）—— 后面几条都依赖它
7. 发现 4（列表密度三档开关）+ 发现 19（标题两行）—— 一屏行数 6.7 → 20+
8. 发现 9（中栏可折叠）+ 发现 8（侧栏折叠态保留图标导航）—— 折叠从「断网」变成真能用
9. 发现 6（头部压扁 + 中段放元数据状态条）+ 发现 14（消除三重复读）

**第 3 批 —— 需要设计取舍，单独评估**

10. 发现 7（空态改工作台首页）—— 信息架构层面的改动，建议先出草图
11. 发现 13-A（列表宽到阈值自动双列）
12. 发现 15（编辑器吃满高度）+ 发现 16（文件栏宽度改 CSS 变量）
13. 发现 13-B（详情双轨 grid：正文 + 常驻右栏）与 发现 20（窄屏兜底）—— 放最后，等前面的宽度体系稳定再动

> 说明：第 1 批全部是改常量/删规则，风险极低但占了总收益的大头；第 2 批的「可拖宽 + 密度开关」是长期天花板所在，建议一并规划 `localStorage` 键位（`ash:sidebar-width` / `ash:list-width` / `ash:list-density` / `ash:content-width`），沿用 `App.jsx:22` 的 `usePersistedState` 即可，不必引新依赖。
