# 运行时流畅度与启动速度 审查

审查对象：`client`（React 19 + Vite 8 + Tailwind 3）与 `../server`（Express + better-sqlite3）。
场景前提：单人、本地、桌面端，无网络延迟，卡顿 = 主线程渲染 / JS 执行。

## 现状摘要（含 bundle 组成分析）

**构建产物（`npm run build` 实测）**

```
dist/index.html                    0.62 kB │ gzip   0.41 kB
dist/assets/index-qRy2s0dd.css    44.60 kB │ gzip   9.57 kB
dist/assets/index-B4e0gNtU.js    496.91 kB │ gzip 158.00 kB   ← 单一 chunk，无代码分割
dist/tailwind.css                 46.33 kB               ← 未被 index.html 引用的死文件
```

**主 chunk 组成**（用 rollup `generateBundle` 统计 renderedLength，压缩前合计 1,032,293 B；压缩比约 48%）：

| 模块 | 压缩前 | 占比 | 备注 |
|---|---|---|---|
| react-dom | 536,883 | 52.0% | 固定成本，不可优化 |
| **highlight.js 语言包** | **222,473** | **21.6%** | `lib/common` 全量 36 种语言；其中 16 种（less/swift/php/perl/csharp/ruby/kotlin/objectivec/r/vbnet/lua/wasm/makefile/graphql/php-template/python-repl）**代码里从未用到**，合计 94,345 B |
| 应用源码 | 127,939 | 12.4% | SkillDetail 34KB / Modals 21KB / App 20KB |
| marked | 56,297 | 5.5% | 启动即解析，实际只在详情页用 |
| highlight.js core | 40,711 | 3.9% | |
| lucide-react | 21,318 | 2.1% | **tree-shake 正常**：42 个模块 = 39 个图标 + shared，未整包引入 |
| react + scheduler | 26,672 | 2.6% | |

结论：`marked + highlight.js` 合计 **319,481 B（31%）** 在首屏同步加载，但它们只服务于「详情页渲染 Markdown / 代码」。lucide-react 和 CSS 都没有问题（CSS 仅 9.57 kB gzip，Tailwind base+utilities 只贡献约 5.8 kB / 1.3 kB gzip，实际只用到 `truncate` / `grid` / `min-w-0` 3 个工具类）。

**架构现状**

- 全部 state 集中在 `App.jsx`（22 个 useState），子组件**零 `React.memo`**，父组件 props **全是内联箭头函数/内联对象** → App 任一 state 变化 = FolderTree + SkillList + SkillDetail 整棵树 reconcile。
- 已有的正面设计：`.skill-row` 已加 `content-visibility: auto; contain-intrinsic-size: auto 4.2rem`（index.css:220），列表滚动有兜底；星标已做乐观更新（App.jsx:206-218）；scroll-spy 已有 rAF 节流。
- 当前本地 db 只有 4 条 skill（`server/data/skillhub.db` 实测），所以很多问题**现在感知不到，规模上来立刻爆**——下面用【规模敏感】标注。

---

## 发现（按影响排序）

### 1. 搜索框无防抖：每次按键 = 一次全量请求 + 整树重渲染 + 骨架闪烁
- 位置：`client/src/App.jsx:42`、`84-120`、`146-149`；`client/src/components/SkillList.jsx:78-84`
- 问题：`searchQuery` 直接进 `fetchSkills` 的 `useCallback` 依赖（App.jsx:120），effect（App.jsx:146-149）里 `setTimeout(fetchSkills, 0)` 只能合并同一 tick，**跨按键完全不防抖**。每敲一个字符：① `setLoading(true)` → 列表整块换成骨架（闪烁）；② 发一次 `/api/skills?search=` ③ 服务端 4 个 `LIKE '%kw%'` 全表扫（`server/routes/skills.js:73-77`）④ `setSkills` 后 `setSelectedSkillId` 可能变化 → `SkillDetail` 因 `key` 变化**整个卸载重建 + 重新 fetch 详情 + 重跑 marked/hljs**。这是当前最大的单点卡顿来源。
- 建议：
  1. 加 250ms 防抖：`const deferredQuery = useDeferredValue(searchQuery)`（React 19 自带）或自写 `useDebounced(searchQuery, 250)`，只把防抖后的值放进 `fetchSkills` 依赖；
  2. 搜索期间不要 `setLoading(true)` 清空列表 —— 改成保留旧列表 + 顶部细进度条（避免骨架闪烁）；
  3. 【规模敏感】搜索结果 ≤ 几百条时直接在前端对已拉取的 `folder=all` 结果做过滤，完全不走网络。
- 影响：高　工作量：小

### 2. 代码文件「逐行高亮」，未知扩展名还会逐行 `highlightAuto` —— 实测 500 行阻塞 338ms
- 位置：`client/src/components/SkillDetail.jsx:385-395`（`fileHighlightedLines`）、`201-211`（`highlightCode`）、`196-199`（`languageForPath`）
- 问题：打开非 Markdown 附件时，把文件按 `\n` 拆开，**对每一行单独调一次 hljs**。当扩展名不在 `EXT_LANGUAGES`（SkillDetail.jsx:180-194）中时 `language` 为 `null`，于是走 `hljs.highlightAuto(line)` —— 对 36 种语言逐一试跑，**每行一次**。实测（Node，highlight.js 11.12）：

  | 方式 | 500 行耗时 |
  |---|---|
  | 逐行 `highlightAuto` | **338 ms** |
  | 逐行 `highlight(js)` | 17 ms |
  | 整文件 `highlight(js)` | 17 ms |
  | 整文件 `highlightAuto` | 144 ms |

  这段跑在 `useMemo` 里 = 渲染期同步执行，直接阻塞 paint；另外逐行高亮还会**切断跨行语法**（多行字符串/块注释高亮错乱），并生成 N 个 `<span dangerouslySetInnerHTML>` React 元素（SkillDetail.jsx:722-724）。
- 建议：整文件高亮一次，再按 `\n` 切分已高亮的 HTML（hljs 输出的 span 需要跨行补齐，可用 hljs 官方的 line-numbers 思路：整体高亮 → 按行拆 → 对每行补未闭合标签）；或干脆去掉行号、直接 `<pre><code dangerouslySetInnerHTML={整文件高亮}/>`。同时**禁用 `highlightAuto`**：未知扩展名直接走转义纯文本（`highlightCode` 的 catch 分支已有现成实现，SkillDetail.jsx:208-210）。
- 影响：高　工作量：中

### 3. 大纲 scroll-spy 每帧 `querySelectorAll` + 逐标题 `getBoundingClientRect`
- 位置：`client/src/components/SkillDetail.jsx:433-458`（尤其 441、444-446）
- 问题：滚动时每个 rAF 都重新 `container.querySelectorAll('h1,h2,h3,h4')`，然后对**每个标题**调 `getBoundingClientRect()` —— 每次都是强制同步布局（forced reflow）。100 个标题的长文档 = 每帧 100 次 layout 读取，滚动掉帧。`jumpToHeading`（491-514）同样每次 `querySelectorAll`。
- 建议：改用 `IntersectionObserver`（`rootMargin: '0px 0px -85% 0px'`）监听标题，回调里只更新 index，零 rect 读取；或退一步：渲染后把 node 列表 + `offsetTop` 缓存进 ref（内容变化时重建），滚动时只比 `container.scrollTop`，不读 rect。
- 影响：高　工作量：中

### 4. 文件栏拖拽调宽：每次 mousemove 触发 setState + **同步写 localStorage**
- 位置：`client/src/components/SkillDetail.jsx:287-307`（`onMove` → `setFileSidebarWidth`）、`278-280`（宽度持久化 effect）
- 问题：`mousemove` 每像素 `setFileSidebarWidth(next)` → 整个 `SkillDetail`（含大纲、文件树、markdown 文章）重新 reconcile；同时 `useEffect([fileSidebarWidth])` 每次都 `localStorage.setItem` —— 每像素一次同步 I/O。拖拽必然掉帧。
- 建议：拖拽期间直接写 CSS 变量/`element.style.width`（ref 操作，不走 React），`mouseup` 时才 `setState` + 落盘；至少把 localStorage 写入改成 `mouseup` 触发或 200ms 防抖。
- 影响：高　工作量：小

### 5. 列表接口返回全文 `content`，详情页又重复拉一次 → 每次打开技能跑两遍 Markdown 渲染
- 位置：`server/routes/skills.js:57`（`SELECT id, slug, name, description, folder_path, tags, content, ...`）；`client/src/components/SkillDetail.jsx:315-334`、`232`、`371-374`
- 问题：
  1. 列表接口把**每个** skill 的 SKILL.md 全文塞进 JSON。【规模敏感】300 个技能 × 5KB = 1.5MB，每次搜索/切目录都要 `JSON.parse` 一遍（本地无网络延迟，但 parse 与 GC 实打实占主线程）。
  2. 详情组件用 `skill.content` 做初始 state（:232）立即渲染一次 markdown，随后 `getJson('/api/skills/:id')`（:317）拿到**同样的内容**再 `setContent` → `renderedMarkdown` 的 useMemo 依赖 `content` 变化 → **marked + hljs 再跑一次**，DOM 补丁 effect（:400-430）也再跑一次。
- 建议：
  1. 列表 SQL 去掉 `content`（需要摘要就 `substr(content,1,200)`）；`SkillList` 只用到 name/description/folder_path/updated_at/is_starred/slug/tags；
  2. 详情 fetch 回来后先比较 `detail.content === content` 再 `setContent`（或把列表 content 去掉后让详情成为唯一来源，二选一，别两头都要）。
- 影响：高　工作量：小

### 6. 全局零 `memo`/`useCallback`：App 任一 state 变化刷新整棵树
- 位置：`client/src/App.jsx:394-521`（所有子组件 props 全是内联函数/内联对象，例如 :406-413、:432-442、:479-484）；`SkillList.jsx:29`、`FolderTree.jsx:34`、`SkillDetail.jsx:230` 均未包 `memo`
- 问题：`sidebarCollapsed`、`selectedIds`、`sortBy`、`recentSkillIds`、`appError`、任何 modal 开关变化都会重渲染 FolderTree + 整个 SkillList（每行 4~6 个 lucide 图标组件）+ SkillDetail。多选（Cmd 点选，App.jsx:304-326）时 `setSelectedIds` 每次点击都刷新全树。
- 建议：把 `handleSelectFolder / handleToggleStar / handleTrashSkill / handleSelectSkill / onClearSelection / onNewSkill ...` 全部 `useCallback` 化，子组件 `export default memo(SkillList)`。优先级：`SkillList`（行数最多）> `FolderTree` > `SkillDetail`。
- 影响：高　工作量：中

### 7. 命令面板关闭状态下仍在每次 App 渲染重建全部命令项
- 位置：`client/src/components/CommandPalette.jsx:57-89`（`commands` useMemo）、依赖来自 `App.jsx:479-484` 的内联箭头函数
- 问题：`CommandPalette` 的 `if (!isOpen) return null` 在 :128，**hooks 先跑完**；`commands` 的依赖数组含 `onSelectSkill/onSelectFolder/onNewSkill/...`，这些在 App 每次渲染都是新函数 → memo 永远失效 → 每次 App 渲染（含每个搜索按键）都遍历 `skills` 构造 N 个对象 + N 个模板字符串。【规模敏感】
- 建议：App 侧把这些回调 `useCallback` 化；`commands` 拆成两段：数据部分只依赖 `skills/folders`，`action` 用 `useRef` 持有最新回调（或 `execute` 时现查）。
- 影响：中　工作量：小

### 8. 列表每行都 eager 渲染 hover 才可见的操作区（含一个完整的 FolderPicker 组件）
- 位置：`client/src/components/SkillList.jsx:178-200`（`.row-actions`）、`181-189`（每行一个 `FolderPicker`）；`client/src/index.css:237`（`.row-actions { opacity: 0 }`）
- 问题：操作区靠 CSS `opacity: 0` 隐藏，但 DOM 与 React 树全量构建：每行 = 1 个 FolderPicker（自带 3 个 useState + 1 个 useMemo + 1 个 useEffect，FolderPicker.jsx:12-30）+ 3 个按钮 + 4 个 lucide 图标。【规模敏感】500 行 = 500 个 FolderPicker 实例。
- 建议：`.row-actions` 只在 `hoveredId === skill.id || isSelected` 时渲染（`onMouseEnter` 记录 id，配合已有 CSS 过渡）；FolderPicker 更进一步——整个列表共用一个 portal 实例，点击时传 `skillId`。
- 影响：中　工作量：中

### 9. `formatDate` 每行每次渲染新建一个 `Intl.DateTimeFormat`
- 位置：`client/src/components/SkillList.jsx:24-27`
- 问题：`new Intl.DateTimeFormat('zh-CN', {...})` 是重量级构造（要加载 locale 数据），这里在 map 里每行调一次、每次渲染重来。【规模敏感】
- 建议：模块顶层提一个常量 formatter：`const DATE_FMT = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' });`，`formatDate` 只做 `DATE_FMT.format(new Date(value))`。
- 影响：中　工作量：小

### 10. FolderTree 键盘导航 effect 缺依赖数组 → 每次渲染解绑 + 重绑监听
- 位置：`client/src/components/FolderTree.jsx:98-136`（注意 :136 是 `});`，**没有依赖数组**）
- 问题：FolderTree 随 App 每次渲染而渲染（见发现 6），这个 effect 于是每次都 `removeEventListener` + `addEventListener`，每次搜索按键都要做两次。虽然单次开销小，但它是"整树重渲染"的放大器，且这种写法后续极易踩坑。
- 建议：加依赖数组 `[tree, expanded, onSelectFolder]`，或把 `tree`/`expanded` 放进 ref 后用 `[]` 挂一次。
- 影响：中　工作量：小

### 11. 「最近浏览」记录逻辑没用上 `userPickedRef`：自动选中也写 localStorage + 刷新侧栏
- 位置：`client/src/App.jsx:46`（定义）、`322` 与 `479`（写入）、`164-167`（effect **从未读取它**）
- 问题：`userPickedRef` 只写不读。任何 `selectedSkillId` 变化（包括 fetch 后自动选中 `list[0]`，App.jsx:95-98/107-110）都会触发 `setRecentSkillIds` → `usePersistedState` 的 effect 同步 `JSON.stringify` + `localStorage.setItem`（App.jsx:31-35）→ `recentSkills` memo 变化 → FolderTree 再渲染一次。搜索时每按一键就来一轮。既是性能损耗也是功能 bug（注释里的意图没实现）。
- 建议：effect 里 `if (!userPickedRef.current) return;`，并在消费后置回 `false`。
- 影响：中　工作量：小

### 12. 启动即加载 marked + highlight.js 全量 common（其中 16 种语言完全用不到）
- 位置：`client/src/components/SkillDetail.jsx:2-3`（`import { marked }` / `import hljs from 'highlight.js/lib/common'`）；`client/vite.config.js:1-7`（无 `build.rollupOptions`）
- 问题：单 chunk 496.91 kB。`lib/common` 注册 36 种语言（222,473 B 压缩前），但 `EXT_LANGUAGES`（SkillDetail.jsx:180-194）只用 18 种；未使用的 16 种合计 **94,345 B 压缩前（≈45 kB 压缩后）**，它们唯一的用处是喂给 `highlightAuto`（而 `highlightAuto` 本身就该按发现 2 干掉）。
- 建议：
  1. 换成 `highlight.js/lib/core` + 按 `EXT_LANGUAGES` 显式 `hljs.registerLanguage(...)` 这 18 种（`markdown/xml/css/scss` 里 `less` 可省）；
  2. 进一步把 `marked + hljs` 包进动态 import（`const { renderMarkdown } = await import('./markdown')`），让 shell + 列表先可交互；
  3. 配 `manualChunks: { react: ['react','react-dom'] }`，让 258 kB 的 react-dom 独立缓存，改业务代码时不失效。
- 影响：中　工作量：中

### 13. `highlightMarkdownHtml` 把同一段 HTML 解析两遍
- 位置：`client/src/components/SkillDetail.jsx:214-228`
- 问题：`marked.parse()` 出 HTML 字符串 → 建一个 detached `<div>` 用 `innerHTML` 解析一遍 → `querySelectorAll('pre > code')` 改写 → 再 `container.innerHTML` 序列化回字符串 → React 又用 `dangerouslySetInnerHTML` 解析第三遍。长文档（几百 KB SKILL.md）下这是纯浪费。
- 建议：用 marked 的 `walkTokens`/自定义 `renderer.code`（v18 里覆写 `renderer.code({ text, lang })` 是安全的，出问题的是 `heading`——注释 :397-399 也只提到 heading），在生成阶段直接产出高亮后的 `<pre data-lang>`，省掉 detached DOM 往返。
- 影响：中　工作量：中

### 14. 复制按钮用 DOM 直插 + 每块 `addEventListener`，无清理；每次渲染全文 `querySelectorAll`
- 位置：`client/src/components/SkillDetail.jsx:400-430`（注释写「事件委托」，实际是**逐块绑定**）
- 问题：effect 依赖 `[renderedMarkdown, auxRendered, selectedFile, mode]`，每次变化都 `querySelectorAll` 遍历整个 markdown 容器（标题 + 所有 pre），为每个代码块 `createElement` + `addEventListener` + `appendChild` —— 触发一轮额外的 layout/paint，且 effect **没有 cleanup**（`return undefined`），依赖旧 DOM 被替换来"自动"回收监听。
- 建议：改成真正的事件委托——在 `scrollRef` 容器上挂一个 `click` 监听（`e.target.closest('.code-copy')`），按钮用 CSS `::after` 或在 marked renderer 输出阶段一次性写进 HTML 字符串；标题 id 同样应在生成阶段写好（与 `slugifyHeading` 复用同一个 `used` Set），而不是渲染后再 patch。
- 影响：中　工作量：中

### 15. 切换技能强制 remount + 无详情缓存：来回切两个技能 = 每次重新 fetch + 重新渲染
- 位置：`client/src/App.jsx:453-459`（`<SkillDetail key={selectedSkill.id} …>`）、`client/src/components/SkillDetail.jsx:315-334`
- 问题：`key` 变化 → 整个 SkillDetail 卸载重建，所有 state 复位（含 `openDirs`、`fileFilter`、文件栏宽度要重新读 localStorage，:248-253 两次同步读），详情接口重新拉，markdown 重新 parse + 高亮。在列表里上下浏览时，每次方向键/点击都是一次完整重建。
- 建议：保留 `key`（隔离性好），但给详情加一个 `Map<id, detail>` 内存缓存（模块级或 `useRef` 提到 App），命中时同步渲染、后台静默校验；渲染结果（`renderedMarkdown`）也可按 `skill.id + updated_at` 做小 LRU。
- 影响：中　工作量：中

### 16. 列表 / 文件树 / 代码行均无虚拟化
- 位置：`client/src/components/SkillList.jsx:144-206`；`SkillDetail.jsx:113-168`（FileTreeNode）、`722-724`（每行一个 `<span>`）
- 问题：【规模敏感】当前 4 条数据完全无感；技能数上千 / 单文件几千行时，DOM 节点数直接爆。`.skill-row` 已有 `content-visibility: auto`（index.css:220）能挡一部分渲染成本，但 React 元素与事件仍是全量。
- 建议：先给 `.code-line` 和 `.file-tree-row` 也加 `content-visibility: auto; contain-intrinsic-size`（零依赖、改 CSS 即可）；技能数真的破千再上 `@tanstack/react-virtual`——目前**不建议**提前引入（过度设计）。
- 影响：低（当前）/ 高（规模上来后）　工作量：小（CSS）/ 大（虚拟化）

### 17. 「最近浏览」和「加入组合」为了几条数据拉全量技能（含全文）
- 位置：`client/src/App.jsx:88-99`（`/api/skills?folder=all` 后只取 `recentIdsRef` 里最多 8 条）；`client/src/components/Bundles.jsx:40-47`（`openAdd` 同样拉 `folder=all`）
- 问题：叠加发现 5（列表带 content），这两处是最浪费的两个调用点。
- 建议：服务端加一个轻量接口 `/api/skills?fields=summary`（或直接按发现 5 去掉 content），`recent` 视图改成 `/api/skills?ids=1,2,3`。
- 影响：中（叠加发现 5）　工作量：小

### 18. 每次写操作都全量 `refreshAll`（5 个请求 + 整树刷新 + 重新选中）
- 位置：`client/src/App.jsx:169-183`（`runMutation` → `refreshAll`）、`67-82`（`fetchFoldersAndStats` 并发 4 个请求）
- 问题：移动 / 删除 / 恢复 / 保存 都触发 `fetchSkills + folders + stats + tags + bundles` 共 5 个请求，随后整列表重建、`selectedSkillId` 可能被重置、SkillDetail 可能 remount。批量操作（`handleBatchMove`，:251-269）更是 N 个请求 + 一次全量刷新 + 撤销时再来一轮。星标已经做了乐观更新（:206-218），说明这条路是走得通的。
- 建议：把 move/trash/restore 也改成乐观更新（本地 splice + 失败回滚），`refreshAll` 降级为只刷 `stats`；`fetchFoldersAndStats` 合并成一个 `/api/bootstrap` 接口（本地 sqlite 一次查完）。
- 影响：中　工作量：中

### 19. FolderPicker 打开时连做 3~4 次定位 setState
- 位置：`client/src/components/FolderPicker.jsx:32-103`（`updatePos` → rAF 校准 → `visibility:hidden` 再 `requestAnimationFrame(calibrate)` + `setTimeout(calibrate, 30)`）
- 问题：一次开合最多 4 次 `setPopStyle` → 4 次渲染，且每次都 `document.getElementById('ash-folder-popover')` + `getBoundingClientRect()`（强制布局）。`setTimeout(calibrate, 30)` 是兜底兜到了 `calibrate` 被执行两遍。叠加发现 8（每行一个实例），点开时有可见抖动。
- 建议：把弹层高度约束改为纯 CSS（`max-height: min(16rem, ...)` 已有，见 index.css:536），定位一次算完：`const naturalH` 用一次 rAF 读取即可，去掉 30ms 兜底那次；或改用原生 Popover API / `anchor` 定位（Chrome 桌面端本地场景完全可用）。
- 影响：低　工作量：中

### 20. 构建链路冗余：Tailwind 跑两遍，产出一个没人引用的 46KB CSS
- 位置：`client/package.json:7`（`"build": "tailwindcss -i ./src/index.css -o ./public/tailwind.css --minify && vite build"`）、`client/postcss.config.js:1-6`、`client/index.html`（**没有引用 `/tailwind.css`**）
- 问题：`vite build` 本身已经通过 postcss 处理了 `src/index.css`（产出 `dist/assets/index-*.css`，44.6 kB）；前置的 tailwindcss CLI 又生成一份 `public/tailwind.css` 被原样拷进 `dist/tailwind.css`（46.3 kB）——**没有任何页面引用它**，纯粹拖慢构建 + 污染产物。另外全项目只用到 3 个 Tailwind 工具类（`truncate`×2、`grid`×2、`min-w-0`×1），Tailwind base+utilities 只值 5.8 kB。
- 建议：删掉 build 脚本前半段与 `public/tailwind.css`；若愿意再进一步，把那 3 个类手写进 `index.css` 后移除 tailwind/postcss/autoprefixer 三个依赖（构建更快、少一层配置）。
- 影响：低（运行时无感，构建与产物洁净度收益）　工作量：小

### 21. 服务端：无 gzip、静态资源无长缓存、skills 表无查询索引
- 位置：`server/index.js:16-19`（中间件里没有 `compression`）、`355-364`（`express.static(clientDist)` 未配 `maxAge/immutable`）；`server/db.js:26-41`（skills 表只有 `slug UNIQUE`，没有 `(is_deleted, folder_path, updated_at)` 索引）
- 问题：本地回环下 gzip 收益有限（496 kB 传输 ≈ 几毫秒），但**每次刷新都要重新 revalidate 并重新 parse 整个 chunk**；内容哈希文件名本可 `immutable` 缓存。sqlite 无索引在 4 条数据时无所谓，【规模敏感】上千条后 `ORDER BY updated_at DESC` 会走全表排序。
- 建议：`app.use(express.static(clientDist, { maxAge: '1y', immutable: true, index: false }))` + 单独对 `index.html` 设 `no-cache`；加 `CREATE INDEX idx_skills_list ON skills(is_deleted, folder_path, updated_at DESC)`；`compression` 可选（本地价值低）。
- 影响：低　工作量：小

### 22. dev 模式 StrictMode 双调用：双发请求、双跑 markdown
- 位置：`client/src/main.jsx:6-9`
- 问题：开发时每个 effect 跑两次 → 启动时 `/api/folders`、`/api/skills/stats`、`/api/skills/tags`、`/api/bundles`、`/api/skills` 各发两遍，SkillDetail 详情也拉两遍。这是 React 的刻意设计（帮助发现副作用问题），但如果平时用 `npm run dev` 当日常界面，会直观感觉"启动慢一倍"。
- 建议：保留 StrictMode（它帮你发现的正是发现 10/14 这类问题）；如果日常使用走 dev server，建议改成 `npm run build` + Express 托管 `dist`（server/index.js:355 已支持）。列为【推测】：需实际对比才知感知差多少。
- 影响：低（仅 dev）　工作量：小

### 23. FileTreeNode 每次渲染重排子节点 + 递归 `hasSelectionInside`
- 位置：`client/src/components/SkillDetail.jsx:105-111`（每次渲染 `[...node.children.values()].sort(localeCompare)`）、`482-489`（`hasSelectionInside` 递归）、`133`（每个折叠目录都调一次）
- 问题：`localeCompare` 相对昂贵；`hasSelectionInside` 对每个目录节点做一次全子树递归 → 深树上是 O(n²)。文件树几十个文件时无感，技能包含几百个文件时会拖慢详情页首帧。【规模敏感】
- 建议：在 `buildFileTree`（:88-103）阶段就把 children 排好序并预计算"该子树是否包含 selectedFile"（一次自底向上遍历），渲染期只做 O(1) 查表。
- 影响：低　工作量：小

---

## 建议的实施顺序

**第一批（改动小、收益最大，一次 MR 就能做完）**
1. 搜索防抖 + 搜索期不清空列表（发现 1）
2. 关掉逐行 `highlightAuto`、改整文件高亮（发现 2）
3. 拖拽调宽改 ref 直写 + `mouseup` 才落盘（发现 4）
4. 列表接口去掉 `content` + 详情内容相同时不重设 state（发现 5、17）
5. `formatDate` formatter 提到模块顶层（发现 9）
6. `userPickedRef` 真正生效（发现 11）
7. FolderTree 键盘 effect 补依赖数组（发现 10）
8. 删掉冗余 Tailwind 构建步骤与 `public/tailwind.css`（发现 20）

**第二批（结构性，但路径清晰）**
9. App 回调全量 `useCallback` + 子组件 `memo`（发现 6、7）
10. scroll-spy 换 `IntersectionObserver`（发现 3）
11. hljs 换 `lib/core` + 按需注册 18 种语言；配 `manualChunks` 拆 react-dom（发现 12）
12. 行操作区按 hover 懒渲染 + 全列表共用一个 FolderPicker（发现 8、19）

**第三批（收益中等、改动面大，按需做）**
13. marked/hljs 动态 import，让 shell 先可交互（发现 12 的第 2 步）
14. markdown 渲染管线合并：renderer 阶段直接产出高亮 + 标题 id + 复制按钮，去掉 detached DOM 往返与 DOM patch effect（发现 13、14）
15. 详情结果内存缓存（发现 15）
16. move/trash/restore 乐观更新 + `/api/bootstrap` 合并首屏 4 个请求（发现 18）
17. 服务端静态资源 immutable 缓存 + skills 列表索引（发现 21）
18. `.code-line` / `.file-tree-row` 加 `content-visibility`；虚拟化留到技能数破千再议（发现 16、23）

**不建议现在做**：引入虚拟化库、引入状态管理库（zustand/jotai）、加 service worker、上 gzip 中间件 —— 单人本地场景 ROI 不足，`useCallback`+`memo` 已经能解决绝大部分重渲染问题。
