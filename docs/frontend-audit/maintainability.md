# 可维护性 审查

审查对象：`client`
审查基线：工作树当前状态（`App.jsx` 实测 525 行，非任务书写的 586 行；差值应为其他维度尚未落盘的改动，拆分方案已按"还会再长 100 行"留余量）。
本审查只读，未修改任何文件，未做任何 git 操作。

---

## 现状摘要（含 App.jsx 职责清单）

### 规模

| 文件 | 行数 | 性质 |
|---|---|---|
| `src/components/SkillDetail.jsx` | 782 | 第一大 God component |
| `src/index.css` | 570 | 唯一真正的样式文件 |
| `src/App.jsx` | 525 | 第二大 God component，全局状态中枢 |
| `src/components/Modals.jsx` | 338 | 4 个弹窗 + DialogShell |
| `src/components/FolderTree.jsx` | 319 | 侧栏全部内容 |
| `src/components/SkillList.jsx` | 211 | 中栏列表 |
| `src/components/FolderPicker.jsx` | 193 | 含 80 行浮层定位数学 |
| `src/components/CommandPalette.jsx` | 177 | ⌘K |
| `src/components/Bundles.jsx` | 176 | 3 个组合相关弹窗 |
| `src/components/Toast.jsx` + `toastBus.js` | 55 + 11 | 事件总线式 toast |
| `src/App.css` | 1（仅一行注释） | **死文件，没人 import** |
| `scripts/ui-regression.test.mjs` | 53 | 4 个源码字符串断言 |
| 合计 src | ~3400 | 无 TS、无 JSDoc、无组件测试 |

关键结构事实：没有 `src/lib/`、没有 `src/hooks/`、没有 `src/types`。所有非 UI 逻辑（HTTP、格式化、解析、常量）全部内联在组件文件里。

### App.jsx 承担的职责（9 类，全部混在一个函数体）

| # | 职责 | 行号 | 说明 |
|---|---|---|---|
| 1 | HTTP 客户端 | 12–19 | `requestJson()` 定义在组件文件顶层 |
| 2 | 通用持久化 hook | 21–37 | `usePersistedState` 定义在组件文件顶层 |
| 3 | 全局状态容器 | 40–65 | **21 个 useState/useRef**：筛选(4) + 数据(4) + 选择(3) + 加载/错误(2) + 弹窗开关(6) + 组合(2) |
| 4 | 数据获取与编排 | 67–120, 122–149, 169–171 | 3 个 fetch 函数 + 4 个 effect（含 `setTimeout(…,0)` 规避级联渲染的 workaround） |
| 5 | 深链解析 | 127–144 | 读 `?skill=` query，拉详情，切文件夹 |
| 6 | 全局键盘 | 151–161 | ⌘K/Ctrl+K 面板开关 |
| 7 | 业务 mutation | 173–301 | 11 个 handler：建/改/删文件夹、星标（乐观更新）、移动、废纸篓、批量移动、批量删、永久删、建技能、存技能，全部内联 URL + headers + JSON.stringify |
| 8 | 选择模型 | 303–326 | Cmd 多选 / Shift 范围选 / 单选 + `lastSelectedIndex` 游标 |
| 9 | 排序/派生/拖拽/布局渲染 | 328–356, 358–524 | 排序 memo、recent memo、drop handler、三栏布局 JSX、7 个弹窗挂载 |

**判据**：这 9 类职责里，只有第 9 类的一半（布局 JSX）必须留在 App.jsx。其余全部可外迁，且外迁后各自可单测。

### 三套样式体系的真实占比

- **`index.css` 570 行手写 BEM-ish 类**：承担 100% 的实际视觉。
- **Tailwind**：`@tailwind base/components/utilities` 三行在 `index.css:1-3`，但全项目只用到 **3 处、2 个类**（`App.jsx:377` 的 `min-w-0`，`FolderTree.jsx:199/292` 的 `truncate`）。为 2 个类拖入 preflight 全量 reset + 构建链。
- **`App.css`**：1 行注释，无人 import，纯死文件。
- **`public/tailwind.css`（46KB，git 追踪）**：`package.json:8` 的 build 脚本把 Tailwind CLI 产物写进 `public/`，但**全仓库没有任何 HTML/JS 引用它**（已 grep 确认 `index.html`、`server/`、`Dockerfile` 均无引用）。它同时是：①无用产物 ②被 git 追踪，每次 build 都脏工作树 ③被 vite 当 public 资源复制进 dist，白占 46KB。

---

## App.jsx 拆分方案

> 原则：先抽**纯函数（lib）**→ 再抽**状态（hooks）**→ 最后抽**JSX（components）**。每一步都能独立跑 `npm run check`，任一步中断都不留半成品。
> 下表行数为迁移后的估计值（含必要的 JSDoc）。

### 第一层：lib（纯函数，无 React，最容易写单测）

| 新文件 | 迁入内容 | 行数 | 依赖 |
|---|---|---|---|
| `src/lib/api.js` | `App.jsx:12-19` 的 `requestJson`；`SkillDetail.jsx:172-177` 的 `getJson`（完全重复）；`App.jsx:190-301,350-354` 里 11 处内联的 URL/method/headers/body；`Modals.jsx:264,277,279,315,320` 5 处裸 fetch；`Bundles.jsx:16,27,34,43,50,125,155` 7 处裸 fetch。按资源导出 `skillsApi / foldersApi / bundlesApi / versionsApi` | ~110 | 无 |
| `src/lib/format.js` | `SkillList.jsx:24-27` `formatDate`；`Modals.jsx:303` 的 `new Date(x+'Z').toLocaleString`；`SkillDetail.jsx:163` 与 `Modals.jsx:304` 两处 KB 换算；`Modals.jsx:93-94,162` 与 slug 相关的 3 段正则 | ~55 | 无 |
| `src/lib/frontmatter.js` | `SkillDetail.jsx:25-35` `splitFrontmatter`、`:79-86` `parseFrontmatterPairs`、`Modals.jsx:146-164` `parseSkillMarkdown`（三者解析同一种东西，当前三套实现） | ~60 | 无 |
| `src/lib/constants.js` | `SkillList.jsx:16-22` `folderLabels`；`FolderTree.jsx:18-23` `navItems`；`App.jsx:479` 硬编码的 `['inbox','all','starred','trash']`；`FolderPicker.jsx:26,181` 的 `'inbox'→'收件箱'`；`SkillDetail.jsx:180-194` `EXT_LANGUAGES` | ~45 | `lucide-react` |
| `src/lib/cx.js` | 全项目 17 处 `` `a${x ? ' is-b' : ''}` `` 模板拼接 | ~8 | 无 |
| `src/lib/markdown.js` | `SkillDetail.jsx:23`(marked 配置), `:37-76`(extractHeadings/slugifyHeading), `:196-228`(languageForPath/highlightCode/highlightMarkdownHtml) | ~115 | `marked`, `highlight.js` |

### 第二层：hooks（状态与副作用）

| 新文件 | 迁入内容 | 行数 | 依赖 |
|---|---|---|---|
| `src/hooks/usePersistedState.js` | `App.jsx:21-37`；并接管 `SkillDetail.jsx:248-251,278-280`（面板宽度）与 `:253,282-284`（大纲显隐）两处手写 localStorage | ~30 | 无 |
| `src/hooks/useSkills.js` | `App.jsx:49,56-57,84-120,146-149,169-171,328-331` + 全部 skill mutation `:206-301`。对外返回 `{ skills, sortedSkills, loading, error, refresh, toggleStar, move, trash, restore, destroy, create, save, batchMove, batchTrash }` | ~150 | `lib/api`, `lib/constants` |
| `src/hooks/useLibraryMeta.js` | `App.jsx:50-52,61,67-82` + 文件夹 mutation `:190-204`（folders / stats / tags / bundles 四者永远一起刷新，合成一个 hook 而非拆四个） | ~70 | `lib/api` |
| `src/hooks/useSelection.js` | `App.jsx:53-55,99,111,303-326`，外加 `SkillList.jsx:58-63,66-71` 的键盘选择与拖拽 payload | ~65 | 无 |
| `src/hooks/useRecentSkills.js` | `App.jsx:45-48,163-167,333-336`；顺带修掉 `userPickedRef` 写而不读的问题（见发现 #3） | ~35 | `usePersistedState` |
| `src/hooks/useModals.js` | `App.jsx:58-65` 的 6 个布尔 + 2 个 target 状态，合成 `useReducer`，对外 `{ modal, open(name, payload), close() }` | ~40 | 无 |
| `src/hooks/useGlobalHotkeys.js` | `App.jsx:151-161`；结构上能容纳后续新增快捷键（其他维度若加快捷键直接进这里） | ~35 | 无 |
| `src/hooks/useDeepLink.js` | `App.jsx:127-144` | ~25 | `lib/api` |
| `src/hooks/useCopyFeedback.js` | `SkillDetail.jsx:520-528`、`Modals.jsx:218-226`、`Bundles.jsx:60-64` 三份几乎一致的"复制 + 1800ms 后复位"逻辑 | ~28 | 无 |

### 第三层：components（JSX）

| 新文件 | 迁入内容 | 行数 | 依赖 |
|---|---|---|---|
| `src/components/AppSidebar.jsx` | `App.jsx:361-416`（折叠壳 + brand + FolderTree 的 14 个 prop 接线） | ~70 | `FolderTree` |
| `src/components/DetailPane.jsx` | `App.jsx:446-472`（错误条 + SkillDetail + 空状态三分支） | ~45 | `SkillDetail` |
| `src/components/ModalHost.jsx` | `App.jsx:474-522`（CommandPalette + 6 个弹窗的集中挂载与开关） | ~80 | `useModals` + 各弹窗 |

### 拆分后的 App.jsx

```
App.jsx  ≈ 85 行
├─ 5 个 hook 调用（useSkills / useLibraryMeta / useSelection / useRecentSkills / useModals）
├─ 2 个副作用 hook（useGlobalHotkeys / useDeepLink）
├─ handleDropOnFolder（10 行，纯编排）
└─ <div className="app-shell"> 三栏 + <ModalHost /> + <ToastContainer />
```

### 顺带该做的 SkillDetail.jsx 拆分（782 → ~260）

| 新文件 | 迁入内容 | 行数 |
|---|---|---|
| `src/components/detail/FileTree.jsx` | `:88-170` buildFileTree + FileTreeNode；`:460-489` 过滤与展开逻辑；`:614-661` 侧栏 JSX 与拖拽调宽 | ~180 |
| `src/hooks/useDocOutline.js` | `:262-263,363-369,432-458,491-514` 大纲提取 + scroll-spy + jumpToHeading | ~95 |
| `src/hooks/useResizablePanel.js` | `:248-251,264,286-313` 拖拽调宽 | ~50 |
| `src/components/detail/DetailToolbar.jsx` | `:560-595` 面包屑 + 5 个动作按钮 + 模式切换 | ~75 |
| `src/components/detail/MarkdownView.jsx` | `:400-430` DOM 补丁 effect + `:704-765` 预览 JSX | ~120 |

---

## 发现（按影响排序）

### 1. App.jsx 是 9 职责 God component，任何改动都要通读 525 行

- **位置**：`client/src/App.jsx:39-525`（全文）
- **问题**：HTTP 客户端、持久化 hook、21 个状态、4 个 effect、11 个 mutation handler、选择模型、排序、拖拽、三栏布局、7 个弹窗挂载全在一个函数体内。改"批量移动"要在 `:251-269` 和它引用的 `:169-171 refreshAll`、`:173-183 runMutation`、`:54 selectedIds` 之间来回跳。没有任何一块能被单独测试或单独读懂。
- **建议**：照上表三层拆分。**必须按 lib → hooks → components 的顺序**，因为 hooks 依赖 lib、components 依赖 hooks，反过来做会产生循环引用和反复返工。每抽出一个文件就跑一次 `npm run check` + 手动点一遍该功能。
- **影响**：高　**工作量**：大

### 2. 三套 HTTP 调用方式并存，12 处裸 fetch 且错误被静默吞掉

- **位置**：`App.jsx:12-19`（`requestJson`）、`SkillDetail.jsx:172-177`（`getJson`，与前者逐字重复）、`Modals.jsx:264,277,279,315,320`、`Bundles.jsx:16,27,34,43,50,125,155`
- **问题**：三种风格互不知情。裸 fetch 的那 12 处大多**不检查 `response.ok`**：`Bundles.jsx:27,34,50,155` 直接 `await fetch(...)` 然后当成功处理；`Modals.jsx:315-321` 改标签失败无任何反馈。`App.jsx:258,273,277` 的批量操作用 `.catch(() => null)` 显式吞错，`ids.length` 个里失败几个用户完全不知道。这违反全局 CLAUDE.md「错误不吞」的红线。
- **建议**：建 `src/lib/api.js`，导出统一的 `request()` 以及按资源分组的调用（`skillsApi.move(id, folder)` 等）。所有组件只调这些函数。批量操作改用 `Promise.allSettled` 并把失败数量喂给 `showToast`。
- **影响**：高　**工作量**：中

### 3. `userPickedRef` 写而不读——死状态，且它要保护的功能实际失效

- **位置**：`App.jsx:46`（声明）、`:322`（赋值 true）、`:479`（赋值 true）；全文**没有任何读取点**
- **问题**：注释写着"只有用户主动点选才计入最近浏览"，但 `:164-167` 的 recent 记录 effect 只依赖 `selectedSkillId`，完全没读这个 ref。结果：列表自动选中第一项（`:96-98,107-110`）也会被记进"最近浏览"，这正是 commit `d4d96cc`（"recent counter only tracks user-picked skills"）想修而没修成的。这是典型的"注释和 ref 都在，功能不在"——下一个读代码的人（作者本人）会以为它生效了。
- **建议**：抽 `useRecentSkills(selectedSkillId)` 时一并修：把"记录最近浏览"改成由 `handleSelectSkill` / palette 的 `onSelectSkill` **显式调用** `recordRecent(id)`，删掉 effect 和 ref。
- **影响**：高　**工作量**：小

### 4. 系统文件夹的 id 与中文名散落 4 处定义，已经开始不一致

- **位置**：`SkillList.jsx:16-22`（5 个：含 `recent`）、`FolderTree.jsx:18-23`（4 个：无 `recent`，`recent` 在 `:254-265` 单独硬写了一段）、`App.jsx:479`（`['inbox','all','starred','trash']`，**漏了 `recent`**）、`FolderPicker.jsx:26,181`（`inbox → 收件箱`）
- **问题**：`App.jsx:479` 的漏项意味着从 ⌘K 选中一个 recent 视图里的技能时，`currentFolder` 会被错误地切成 `'all'`。加第 6 个系统视图要改 4 个文件，而且很容易再漏一个。另外 `FolderTree.jsx:254-265` 的缩进明显是手工粘贴留下的（比同级 `<li>` 多 14 个空格）。
- **建议**：`src/lib/constants.js` 导出单一 `SYSTEM_FOLDERS = [{ id, label, icon }]` 与派生的 `SYSTEM_FOLDER_IDS` / `FOLDER_LABELS`，4 处全部改为引用；`FolderTree` 的 recent 项回归 `navItems.map`。
- **影响**：高　**工作量**：小

### 5. 782 行的 SkillDetail.jsx，同样是 God component

- **位置**：`client/src/components/SkillDetail.jsx:230-782`
- **问题**：单个组件里有 **18 个 useState + 4 个 useRef + 8 个 useEffect + 7 个 useMemo**，同时负责：文件树构建与过滤、markdown 渲染与代码高亮、大纲提取与 scroll-spy、侧栏拖拽调宽、ResizeObserver 响应式收折、编辑/保存/脏检查、版本弹窗、剪贴板复制。`:663` 那一行的 class 拼接条件是 `mode === 'preview' && !outlineHidden && outlineFits && headings.length > 1`，同样的 4 项条件在 `:664` 和 `:689` 各重复一次（取反）。
- **建议**：按上表拆出 `FileTree.jsx` / `useDocOutline` / `useResizablePanel` / `DetailToolbar` / `MarkdownView`；那个 4 项条件抽成 `const showOutline = ...` 一个变量。
- **影响**：高　**工作量**：大

### 6. `public/tailwind.css`（46KB 构建产物）被 git 追踪，而且没有任何人引用

- **位置**：`client/package.json:8`（`"build": "tailwindcss -i ./src/index.css -o ./public/tailwind.css --minify && vite build"`）；`git ls-files client/public` 显示 `client/public/tailwind.css` 在版本控制中；`client/.gitignore` 只忽略了 `dist`
- **问题**：①它是产物不是源码，每次 `npm run build` 都会让工作树变脏，制造假 diff ②全仓 grep 确认 `index.html`、`server/`、`Dockerfile`、`docker-compose.yml` 都不引用它 ③vite 会把 `public/` 原样复制进 `dist/`，于是 46KB 死文件被打进发布包 ④它是 `index.css` 经 Tailwind CLI 处理的**另一份完整副本**，和 vite 走 postcss 产出的那份内容重叠，未来改样式时很可能对着错的那份调试。
- **建议**：①从 build 脚本里删掉 `tailwindcss -i ... &&`（vite 已经通过 `postcss.config.js` 处理 Tailwind，这一步纯属重复）②`git rm --cached client/public/tailwind.css`，并把它加进 `client/.gitignore`。（注：涉及 git 写操作，留给作者执行）
- **影响**：高　**工作量**：小

### 7. Tailwind 为 2 个类拖进整条构建链

- **位置**：`src/index.css:1-3`；实际用量仅 `App.jsx:377`(`min-w-0`)、`FolderTree.jsx:199`(`truncate`)、`FolderTree.jsx:292`(`truncate`)
- **问题**：3 个 `@tailwind` 指令带来 preflight 全量 reset（与 `index.css:46-76` 的手写 reset 部分重叠、互相覆盖）、`tailwind.config.js`、`postcss.config.js`、一个 devDependency 和 build 脚本里的一步。收益是 2 个工具类。对"未来改它的人是作者自己"这个目标，多一套心智模型的成本远大于收益。
- **建议**：两条路，二选一。**推荐 A**：在 `index.css` 手写 `.min-w-0{min-width:0}` `.truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`（后者 `index.css` 里已经内联写过 8 次同样三行），删掉 Tailwind 全链。**B**：如果打算未来大量用 Tailwind，那就反过来把 `index.css` 往 Tailwind 迁——但这是几天的工作量，单人自用项目不值。选 A 的理由：删掉后 `index.css` 少一层 preflight 覆盖，样式调试从"查两套规则"变成"查一套"。
- **影响**：中　**工作量**：小（A）

### 8. CSS 死样式约 10 组，其中一整套"编辑分栏"功能已删但样式还在

- **位置**：`src/index.css` —— `:289-297`（`.attachment-strip` / `.attachment-list`，已被 `.file-sidebar` 文件树取代）、`:477-484`（`.editor-toolbar` / `.live-preview-toggle` / `.editor-split` / `.editor-source` / `.editor-preview`，C2 实时预览分栏功能已移除）、`:390-394`（`.folder-choice-list`）、`:278`（`.move-select`，被 `FolderPicker` 取代）、`:201-203`（`.tag-filter`，同上）、`:175-176`（`.nav-divider`）、`:448`（`.recent-item`，最近浏览列表根本没渲染，见发现 #9）、`:301`（`.file-tree ul` 的 `calc(.95rem + var(--tree-depth,0) * 0rem)`——**乘以 0rem 的空计算**）
- **问题**：改样式时这些规则会持续干扰搜索结果；`.editor-*` 一整套让人以为分栏预览还在。
- **建议**：逐条确认后删除（`.dialog-small` / `.dialog-medium` / `.dialog-large` 看似无引用但实际由 `Modals.jsx:54` 的 `dialog-${size}` 动态拼出，**不要删**——顺手在该行上方加一行注释标明）。`.file-tree ul` 那条改成固定 `padding-left: .95rem`。
- **影响**：中　**工作量**：小

### 9. `recentSkills` 传进 FolderTree 却只用来取 `.length`

- **位置**：`App.jsx:333-336,409` → `FolderTree.jsx:52,263`
- **问题**：`App.jsx` 花了一个 `useMemo` 算出前 5 个最近技能对象数组，`FolderTree` 只用 `recentSkills.length` 显示计数，从不渲染它们；配套的 `.recent-item` 样式（`index.css:448`）因此从未生效。而且这个 length 与实际 recent 视图的内容口径不同（`App.jsx:334` 只在当前 `skills` 里找，切到别的文件夹时计数会缩水）。
- **建议**：`useRecentSkills` 只对外暴露 `recentIds`，侧栏计数用 `recentIds.length`；删掉 `recentSkills` memo 和 `.recent-item`。
- **影响**：中　**工作量**：小

### 10. 复制到剪贴板 + 1800ms 复位，三份重复实现且失败处理各不相同

- **位置**：`SkillDetail.jsx:520-528`（失败 → `setDetailError`）、`Modals.jsx:218-226`（失败 → `setError`）、`Bundles.jsx:60-64`（**完全不 try/catch**，剪贴板被拒直接 unhandled rejection）；第四份在 `SkillDetail.jsx:415-425` 的命令式按钮里（失败静默 `catch {}`）
- **建议**：抽 `useCopyFeedback()` 返回 `{ copiedKey, copy(text, key) }`，统一走 `showToast` 报失败。四处替换。
- **影响**：中　**工作量**：小

### 11. 日期格式化两套实现，时区处理相反

- **位置**：`SkillList.jsx:24-27`（`new Date(value)`，不加 Z）、`Modals.jsx:303`（`new Date(v.created_at + 'Z')`，**手工补 Z**）
- **问题**：同一个 SQLite 时间串，列表页当本地时间解析、版本列表当 UTC 解析，东八区下两处显示能差 8 小时。谁对谁错要翻后端才知道——这正是"改起来怕"的来源。另外 KB 换算也有两份：`SkillDetail.jsx:163` 用 `Math.max(1, Math.round(size/1024))`，`Modals.jsx:304` 用 `Math.round(size/1024)`（0 KB 会出现）。
- **建议**：`src/lib/format.js` 统一 `formatDate` / `formatDateTime` / `formatKB`，并在文件头用一行注释钉死"后端时间串是 UTC 无时区后缀，一律补 Z"（或相反，以后端实际为准）。
- **影响**：中　**工作量**：小

### 12. frontmatter 解析 / slug 生成 各有两套实现，行为不一致

- **位置**：frontmatter —— `SkillDetail.jsx:25-35`（`splitFrontmatter`，用 `indexOf('---',3)`）vs `Modals.jsx:151-160`（`parseSkillMarkdown`，同样 `indexOf` 但只抽 name/description/tags）；slug —— `Modals.jsx:93-94`（`toLowerCase().replace(/[^a-z0-9_-]/g,'-')`）vs `Modals.jsx:162`（同样 + `.replace(/-+/g,'-').replace(/^-|-$/g,'')`）
- **问题**：同一个弹窗文件里，手填名字生成的 slug 会留下 `my---skill`，粘贴导入生成的 slug 是 `my-skill`。后端还用 `gray-matter` 解析第三套。
- **建议**：`src/lib/frontmatter.js` 一套 `splitFrontmatter` + `parseFrontmatterPairs` + `parseSkillMeta`；`src/lib/format.js` 一个 `slugify`。这是最适合写单测的一批函数（见发现 #18）。
- **影响**：中　**工作量**：小

### 13. className 三元拼接 17 处、写法四种，且有个 camelCase 类名破坏命名约定

- **位置**：`FolderTree.jsx:179,193,243,257`、`SkillDetail.jsx:156,663,680,700` 等（共 17 处）；写法差异 —— `` `skill-row${x ? ' is-selected' : ''}` ``（SkillList:154，无空格前缀）vs `` `folder-select ${x ? 'is-active' : ''}` ``（FolderTree:193，**始终留一个尾空格**）vs `` `nav-item ${x ? 'is-active' : ''}` ``（FolderTree:243）
- **问题**：改一个状态类要先辨认当前行用的是哪种写法。另外 `FolderPicker.jsx:121` 产出的类名是 `iconOnly`（camelCase），对应 `index.css:493-494` 的 `.folder-picker.iconOnly`——全项目其余 100+ 个类名都是 kebab-case，这一个是孤例，搜索 `icon-only` 会找不到。
- **建议**：加 8 行的 `src/lib/cx.js`（`cx('skill-row', isSelected && 'is-selected')`），17 处统一；同时把 `iconOnly` 改名 `is-icon-only`（JSX 与 CSS 各改一处）。
- **影响**：中　**工作量**：小

### 14. props 爆炸：SkillList 22 个、FolderTree 17 个，其中 4 个布尔开关

- **位置**：`SkillList.jsx:29-53`（22 个 prop，App 侧 `:419-443` 对应 25 行接线）；`FolderTree.jsx:34-54`（17 个）；`FolderPicker.jsx:8-11`（`compact` / `iconOnly` 两个布尔 + `placeholder` 有时是字符串有时是 JSX 元素，见 `SkillList.jsx:185` 传 `<FolderInput />`）
- **问题**：加一个列表操作要同时改 App 的 handler、App 的 JSX 接线、SkillList 的解构、SkillList 的 JSX——四处。`FolderPicker` 的 `placeholder` 参数一词两义（占位文字 / 图标元素）是隐式契约，只能靠读调用点才知道。
- **建议**：①`SkillList` 收下 `useSkills()` 返回的 `actions` 对象一个 prop，替代 8 个 `onXxx`；②`FolderPicker` 的 `compact`/`iconOnly` 合成 `variant: 'default' | 'compact' | 'icon'`，`iconOnly` 模式下的图标改用独立的 `icon` prop，`placeholder` 恢复纯字符串语义；③配 JSDoc `@param` 说明每个 prop（见发现 #19）。
- **影响**：中　**工作量**：中

### 15. toastBus 用法不一致：既 import 又当 prop 传

- **位置**：`App.jsx:8`（`import { showToast }`）、`App.jsx:503`（`showToast={showToast}` **当 prop 传给 BundleDetail**）、`Bundles.jsx:7,28,35`（`showToast?.('…')`，带可选链因为可能没传）
- **问题**：同一个全局单例，一个组件直接 import、另一个靠父组件注入，还要写防御性可选链。`Modals.jsx` 和 `SkillDetail.jsx` 则第三种做法——完全不用 toast，各自维护局部 `error` state（`Modals.jsx:210,258`、`SkillDetail.jsx:243-244`）。于是"操作失败"这件事有三种呈现路径。
- **建议**：`Bundles.jsx` 直接 `import { showToast } from './toastBus'`，删掉 prop 和可选链；确立一条规则写进注释——**一次性操作的失败走 toast，表单内的校验错误走局部 inline-error**，然后把 `Bundles.jsx` 里那些不检查 `response.ok` 的 fetch 接上 toast。
- **影响**：中　**工作量**：小

### 16. 命令式 DOM 操作：选择器字符串重复 3 次、动态建按钮无清理、直接改 style 不回滚

- **位置**：`SkillDetail.jsx:404,441,494` —— `'.markdown-document h1, .markdown-document h2, .markdown-document h3, .markdown-document h4'` **逐字重复三遍**；`:410-427` —— 手工 `createElement` 复制按钮并 `addEventListener`，**注释写"事件委托，避免重复绑定"但实现是逐元素绑定**，且 effect 没有 cleanup（靠 `:409` 的 `if (pre.querySelector('.code-copy')) return` 兜底）；`:505-508` —— 直接写 `content.style.paddingBottom`，**永不复位**，跳到最后一个标题后这个 padding 会一直留着
- **问题**：三个地方共享的隐式契约是"markdown 标题一定在 `.markdown-document` 下"，CSS 类名成了 JS 的 API；改 markdown 容器类名会静默断掉大纲和 scroll-spy。
- **建议**：①选择器提成模块常量 `const HEADING_SELECTOR = '...'`；②复制按钮改成真正的事件委托（在 `scrollRef` 容器上挂一个 `click` 监听，判断 `event.target.closest('.code-copy')`），按钮本身用 CSS `::after` 或在 marked 后处理阶段作为 HTML 字符串注入；③`paddingBottom` 改由 CSS 的 `scroll-padding-block-end` 或给 `.detail-content` 一个固定的 `padding-bottom: 60vh`（配注释说明是为了末尾标题可达），删掉运行时 style 写入。
- **影响**：中　**工作量**：中

### 17. FolderTree 的键盘 effect 没有依赖数组，每次渲染都重新绑定

- **位置**：`FolderTree.jsx:98-136`（`useEffect(() => {...})` —— `:136` 结尾是 `});`，**无第二参数**）
- **问题**：侧栏每渲染一次就 remove + add 一次 keydown 监听。目前只是浪费，但它掩盖了真实依赖（`tree`、`expanded`、`onSelectFolder`）——将来有人加依赖数组时会漏项并引入过期闭包 bug。同类问题：`Bundles.jsx:22` 用 `// eslint-disable-line react-hooks/exhaustive-deps` 压掉警告，但 oxlint 根本没开这条规则，注释是装饰品。
- **建议**：补上 `[tree, expanded, onSelectFolder]`；同时开启 lint 规则（见发现 #20）后再复查全部 effect。
- **影响**：中　**工作量**：小

### 18. 现有"测试"是源码字符串断言，对重构是纯负资产

- **位置**：`client/scripts/ui-regression.test.mjs:1-53`
- **覆盖了什么**：4 个 test，全部是 `readFile` 源码后 `includes` / `match` 字符串 —— ①App 里存在 7 个特定的 `onXxx={handleXxx}` 字面量 ②SkillDetail 里存在 `getJson(\`/api/skills/${skill.id}\`)` 字面量 ③Modals 里 `useState(` 的下标小于 `if (!isOpen)` 的下标 ④`index.css` 里存在特定的 `grid-template-columns` 和 `line-height: 1.8` 字面量。
- **缺什么**：全部行为。没有一个测试会渲染组件、点击、断言输出。
- **反作用**：本次拆分会让 4 个 test **全部变红**，但没有一个红是因为功能坏了：`onBatchMove={handleBatchMove}` 变成 `actions={actions}`（#14）、`getJson` 移进 `lib/api`（#2）、`index.css` 的 grid 值被其他维度调整——三条都会假报警。测试在"阻止重构"，而不是"保护重构"。
- **建议**：**引入 vitest + @testing-library/react，但范围严格限定**。值得测的：`lib/format.js`、`lib/frontmatter.js`、`lib/cx.js`（纯函数，20 分钟写完 ~25 个 case，覆盖 #11 #12 里那些行为不一致的边界）；`CommandPalette.jsx:5-27` 的 `fuzzyScore`（纯函数，排序规则微妙）；`useSelection` 的 Cmd/Shift 分支（用 `renderHook`）。**不值得测**：`FolderPicker` 的浮层定位（jsdom 里 `getBoundingClientRect` 全返回 0，测不出东西）、任何 markdown 渲染快照（marked 升级就全红）、三栏布局 CSS。
  `ui-regression.test.mjs` 保留但重写为只断言**真正不该变的契约**：`/api/skills/stats` 端点仍被调用、弹窗有 `aria-modal`、`index.css` 里有 `:focus-visible`。删掉所有依赖具体 prop 名和具体 CSS 数值的断言。
  `package.json` 加 `"test": "vitest run"`，`check` 改为 `lint && test && build`。
- **影响**：高　**工作量**：中

### 19. 零类型信息：skill / folder / bundle 的数据形状只能靠读后端反推

- **位置**：全项目无 `.ts`、无 `jsconfig.json`、无一条 `@typedef`。`skill` 对象的字段散落在 `SkillList.jsx:163,174,176,177,191`（name/description/folder_path/updated_at/slug）、`App.jsx:209`（`is_starred` 是 0/1 数字不是布尔）、`SkillDetail.jsx:733`（`tags` 数组）、`:323`（`file_tree`）
- **问题**：`is_starred` 用 0/1 而 `App.jsx:209` 写 `s.is_starred ? 0 : 1`、`SkillList.jsx:169` 写 `Boolean(skill.is_starred)`——这类数字/布尔混用正是全局 CLAUDE.md 点名的坑。拆分时把 skill 对象在 hooks 之间传来传去，没有任何东西能告诉你哪些字段一定存在。
- **建议**：**不迁 TS**。理由：3400 行单人自用项目，迁移成本 2–3 天，而 `marked` 后处理、大量 DOM 操作、`dangerouslySetInnerHTML` 这些地方最后大概率写成 `any`，收益打折。**改为 JSDoc + checkJs**：①新建 `src/lib/types.js`，用 `@typedef` 定义 `Skill` / `Folder` / `Bundle` / `SkillFile` / `Version` 五个形状（~40 行，字段以 `server/routes` 实际返回为准）②新建 `client/jsconfig.json` 开 `"checkJs": true` + `"strict": true`，编辑器立刻有补全和红线，**不影响构建**③新 lib/hooks 文件的导出函数都加 `@param` / `@returns`。这是 1 小时拿 70% 收益的做法。
- **影响**：中　**工作量**：小（JSDoc 路线）

### 20. oxlint 只开了 2 条规则，关键的 hooks 规则没开

- **位置**：`client/.oxlintrc.json:1-8` —— `plugins: ["react","oxc"]`，`rules` 里只有 `react/rules-of-hooks` 和 `react/only-export-components`
- **问题**：没开 `react-hooks/exhaustive-deps`（于是发现 #17 的无依赖数组 effect 和 `Bundles.jsx:22` 的 disable 注释都无人管）、没开 `no-unused-vars`（于是发现 #3 的 `userPickedRef` 写而不读没被发现）、没开 `import` 插件（拆分成十几个文件后，循环引用和错误路径会开始出现）。实测 `npx oxlint` 当前只报 2 条 `set-state-in-effect` warning。
- **建议**：`.oxlintrc.json` 改为 `"categories": { "correctness": "error", "suspicious": "warn" }`，`plugins` 加 `"import"`，`rules` 里补 `"react-hooks/exhaustive-deps": "warn"`、`"no-unused-vars": "error"`。**在拆分开始前就打开**——让它在拆分过程中持续报警，比拆完再开一次性收几十条有用。注意先跑一次看基线噪音量，若 `correctness` 一上来几十条，先修再提级。
- **影响**：中　**工作量**：小

### 21. `npm run dev` 实际上不可用：vite 无 /api 代理

- **位置**：`client/vite.config.js:1-7`（只有 `plugins: [react()]`，**无 `server.proxy`**）；`server/index.js:14`（端口 9444）、`:355-357`（静态服务 `client/dist`）
- **问题**：vite dev server 跑在 5173，所有 `/api/*` 请求 404。要看到真实数据必须 `npm run build` 然后访问 express 的 9444 —— 也就是**改一行 CSS 要等一次完整 build**，HMR 形同虚设。`UI-VERIFICATION.md` 里记录的验证地址是 `127.0.0.1:19444`（server），佐证了这条路径。这是本次审查里对"日常改它的舒适度"影响最大的一条。
- **建议**：`vite.config.js` 加 6 行：`server: { proxy: { '/api': 'http://localhost:9444', '/s': 'http://localhost:9444', '/setup.sh': 'http://localhost:9444' } }`（`/s` 和 `/setup.sh` 是 `SkillDetail.jsx:584`、`Modals.jsx:215` 用到的下载/安装路径）。改完 `npm run dev` 就能带真数据热更新。
- **影响**：高　**工作量**：小

### 22. CSS design token 只覆盖颜色，尺寸体系全是 magic number

- **位置**：`src/index.css:25-44`（`:root` 只有 15 个颜色变量 + 字体）
- **数据**：`index.css` 里有 **27 个不同的 font-size 值**（`.72rem` 出现 15 次、`.7rem` 13 次、`.75rem` 9 次、`.68rem` 8 次——这四个视觉上几乎无法区分）、**19 个不同的 border-radius 值**（`.28/.3/.32/.34/.35/.36/.38/.4/.42/.45/.46/.48/.5/.65rem`…）、大量 `.55rem/.58rem/.6rem/.65rem` 的间距。
- **问题**：新增一个组件时无从判断"该用 .7 还是 .72"，只能翻附近代码抄，于是值越来越多。
- **建议**：`:root` 补一组 `--fs-xs/sm/md/lg`（4–5 档）、`--r-sm/md/lg`（3 档）、`--sp-1..5`（5 档），**不做一次性全量替换**（那是 570 行的无谓 diff 且容易改出视觉回归）。规则定为：新代码只用 token，改到哪行顺手换哪行。
- **影响**：中　**工作量**：中（渐进）

### 23. 颜色 token 被硬编码 hex 绕过 40+ 次

- **位置**：`index.css` 中 `#3d444d` 出现 9 次、`#c9d1d9` 7 次、`#0b0f14` 6 次、`#1b2129` 4 次、`#090d12` 4 次、`#ff7b72` 4 次、`#484f58` 3 次；其中 `#e6edf3`（=`--text`）和 `#8b949e`（=`--text-muted`）**就是已定义 token 的字面值**（`:61` 的 `select option`、`:12` 附近的 hljs 块）
- **额外**：`:519` 的 `var(--surface-active, #1b2129)` 引用了一个 **`:root` 里根本没定义**的变量（永远走 fallback）；`:264,561` 定义的 `--outline-channel` **没有任何地方 `var()` 读取它**（死变量）。
- **建议**：给 `:root` 补 `--border-strong: #3d444d`、`--bg-deep: #0b0f14`、`--bg-code: #090d12`、`--surface-active: #1b2129`、`--danger-soft: #ff7b72`，把高频 hex 换掉（这批是机械替换，`replace_all` 前先按全局 CLAUDE.md 的提醒 grep 裸值确认上下文）；删 `--outline-channel`。
- **影响**：中　**工作量**：小

### 24. package.json scripts 冗余与缺项

- **位置**：`client/package.json:6-13`、根 `package.json:6-13`
- **问题**：①根的 `build`/`lint`/`test:ui`/`check` 四条全是 `npm --prefix client run X` 的镜像转发，维护时要改两个文件 ②根的 `dev` 和 `start` **完全相同**（都是 `node server/index.js`），而真正的前端 dev 在 `client` 里，容易执行错 ③`client` 的 `build` 串了一个产出垃圾的 tailwind CLI 步骤（见 #6）④没有 `test`（`test:ui` 名字暗示"UI 测试"，实则是源码文本检查）⑤没有 typecheck 入口（JSDoc + checkJs 后应有 `"typecheck": "tsc -p jsconfig.json --noEmit"`）
- **建议**：根只保留 `start` / `dev`（改成同时起 server 和 client vite，或干脆删掉 `dev` 只留 `start`）+ 一条 `check`；`client` 的 build 去掉 tailwind 步骤；`test:ui` 改名 `test:contract`，新增 `test`（vitest）和 `typecheck`；`check` = `lint && typecheck && test && test:contract && build`。
- **影响**：低　**工作量**：小

### 25. Vite 模板残留污染项目认知

- **位置**：`client/src/App.css`（1 行注释，无人 import）、`client/src/assets/hero.png` + `react.svg` + `vite.svg`（三个文件全仓无引用，grep 确认）、`client/README.md`（整篇还是 `# React + Vite` 官方模板文案，讲 SWC 插件和 React Compiler，与本项目零关系）
- **问题**：`App.css` 的存在会让人以为样式分散在两个文件（本审查第一反应也是如此）；`README.md` 在需要"这个前端怎么跑起来"的时候提供零信息。
- **建议**：删 `App.css` 和 3 个未引用 asset；`client/README.md` 重写为 10 行：目录结构、`npm run dev`（配好 proxy 后）、`npm run check`、样式约定一句话（"全部在 index.css，类名 kebab-case，状态类用 is- 前缀"）。
- **影响**：低　**工作量**：小

### 26. 两套 mutation 模式并存（乐观更新 vs 全量 refreshAll），没有规则说明何时用哪个

- **位置**：`App.jsx:206-218`（`handleToggleStar`：本地翻转 + 失败回滚 + 只刷计数）vs `App.jsx:173-183`（`runMutation`：成功后 `refreshAll()` 重拉全部四个接口）
- **问题**：星标走乐观更新是因为 commit `fbc0440` 修过"列表闪烁"；但移动、废纸篓、批量操作仍然全量 refresh，同样会闪。下一次遇到闪烁问题，作者得重新判断该抄哪一套。而且 `refreshAll` 每次拉 5 个接口（skills + folders + stats + tags + bundles），批量操作时连拉两轮。
- **建议**：抽 `useSkills` 时把这条规则写成文件头注释并统一实现：**改变单条记录的字段 → 乐观更新 + 失败回滚 + 只刷计数；改变记录归属/存在性 → refresh 列表 + 计数，但不刷 folders/tags**（只有文件夹 CRUD 才需要刷 folders）。顺带把 `refreshAll` 拆成 `refreshSkills` / `refreshCounts` / `refreshFolders` 三个粒度。
- **影响**：中　**工作量**：中

### 27. `setTimeout(…, 0)` 作为 React 级联渲染的规避手段，出现 4 次且无统一说明

- **位置**：`App.jsx:123,147`（两个数据拉取 effect）、`CommandPalette.jsx:49-53`（注释写明"避免 effect 同步级联渲染警告"）、`FolderPicker.jsx:97-101`
- **问题**：这是 oxlint `react(set-state-in-effect)` 规则的 workaround（该规则目前在 `Bundles.jsx:22`、`Modals.jsx:262` 仍报警）。四处用同一招但只有一处写了原因，其余三处看起来像随手加的延迟。它同时让数据加载比必要的晚一帧。
- **建议**：抽 `src/hooks/useDeferredEffect.js`（或就叫 `useMountedEffect`）把这个模式收口成一个带完整注释的 hook，四处替换；`Bundles.jsx:22` 和 `Modals.jsx:262` 两处剩余警告一并处理（前者的 `load()` 本就该跟着 `bundle?.id` 走，后者的 `setLoading(true)` 可以挪进 `if (!isOpen) return` 之后并用初始值表达）。
- **影响**：低　**工作量**：小

### 28. FolderPicker 的浮层定位：80 行双通道 rAF + 全局单例 DOM id，零测试零文档

- **位置**：`FolderPicker.jsx:32-103`；`:47,78,93` 三次 `document.getElementById('ash-folder-popover')`
- **问题**：①这个 id 是**全局硬编码单例**，而 `FolderPicker` 在页面上同时存在 N+2 个实例（每个技能行一个 `SkillList.jsx:181`、批量条一个 `:107`、标签区一个 `FolderTree.jsx:306`）。当前靠"同时只可能开一个"这个隐式假设成立，但没有任何机制保证；②`:46-91` 的定位逻辑有 `CHROME = 58`、`200`、`140`、`12`、`8`、`6`、`30ms` 七个魔数，含义只在中文注释里；③rAF + 二次 rAF + 30ms setTimeout 的三重校准是逐次试出来的，改动风险高但没有回归保护。
- **建议**：**不重写**（它刚被 `8220d3f`/`8a044f2` 两个 commit 调对，ROI 不支持重写）。只做三件低风险的事：①id 改为 `useId()` 生成，三处 `getElementById` 改用 ref；②七个魔数提成文件顶部的 `const POPOVER = { WIDTH: 256, CHROME: 58, MIN_LIST: 140, MIN_SPACE: 200, GAP: 6, EDGE: 8, CALIBRATE_MS: 30 }`；③在文件头加 5 行注释说明"为什么需要三重校准"（当前的 `:41`、`:45`、`:76` 注释是片段式的）。
- **影响**：低　**工作量**：小

### 29. 批量操作的 undo 闭包捕获了可能过期的 `folder_path`

- **位置**：`App.jsx:251-269`（`handleBatchMove`）—— `:253` 的 `targets` 捕获了操作前的 skill 对象，`:262-266` 的撤销用 `s.folder_path` 回滚
- **问题**：`targets` 是从 `skills`（当前渲染的列表）里 find 出来的；如果用户在 toast 的 5 秒内又移动了同一批技能，撤销会把它们送回**更早**的位置。同样的模式在 `:221-238`（单个移动）。这不是当前会触发的 bug，但拆分成 hook 后这段闭包逻辑会更难看清。
- **建议**：抽 `useSkills` 时，让 mutation 返回服务端确认后的 `{ id, previousFolder }` 列表，撤销基于返回值而非闭包快照；或简单点——撤销前先校验当前 `folder_path` 仍等于刚移动到的目标，不等则跳过并 toast 说明。选后者（改 5 行，够用）。
- **影响**：低　**工作量**：小

---

## 建议的实施顺序

> 前提：本维度**最后实施**，前面的性能/可访问性/UI 维度会先行落地新代码。因此顺序按"**不阻塞别人 → 为别人的代码提供落点 → 最后才动大结构**"排列，并对每一阶段标注它如何容纳前序改动。

### Phase 0 — 零风险清理（1 小时，最先做，且不与任何维度冲突）

删死代码、改配置，**不碰任何活逻辑**，因此和前序维度的 diff 几乎不可能冲突。先做的价值是：让后续所有阶段的 grep 结果和 diff 变干净。

1. `vite.config.js` 加 `/api` proxy（#21）—— **第一件事**。后续所有阶段的手工验证都依赖它，早一秒做早一秒回本。
2. 删 `App.css`、3 个未引用 asset、重写 `client/README.md`（#25）
3. 删 #8 列出的死 CSS 规则，修 `* 0rem` 空计算，删 `--outline-channel`，补 `--surface-active`（#23 的一部分）
4. build 脚本去掉 tailwind CLI 步骤；`public/tailwind.css` 交由作者 `git rm --cached` + 加 gitignore（#6）
5. 修 `userPickedRef`（#3）、`App.jsx:479` 漏掉的 `'recent'`（#4 的 bug 部分）、`FolderTree.jsx:136` 的依赖数组（#17）

**容纳前序改动**：若前面维度动过 `index.css`，删死样式前重跑一次本报告 #8 的核对命令（按类名 grep JSX），以当时实际为准。

### Phase 1 — lib 层（半天）

抽 #2 #11 #12 #13 #22(token 定义) 涉及的纯函数：`api.js` / `format.js` / `frontmatter.js` / `constants.js` / `cx.js` / `markdown.js`。

**为什么排在这**：这一层是"落点"。前面维度新加的任何 fetch、日期显示、类名拼接，在这一步会被一起收编；而且纯函数迁移不改行为，改错了下一阶段的测试立刻抓到。

顺序内部再排：`constants` → `format`/`frontmatter`/`cx`（无依赖）→ `api` → `markdown`。

### Phase 2 — 测试地基（半天）

装 vitest + @testing-library/react，先只给 Phase 1 的 lib 写单测（#18）；同时把 `ui-regression.test.mjs` 瘦身为"契约断言"，**删掉所有会被 Phase 3/4 打红的 prop 名与 CSS 数值断言**。开严 oxlint（#20），加 `jsconfig.json` + checkJs + `lib/types.js`（#19）。

**为什么在 hooks 拆分之前**：Phase 3/4 是本轮唯一有真实回归风险的部分，必须先有网。而且测 lib 纯函数的 ROI 最高（#11 #12 的行为不一致会在写 case 时当场暴露）。

### Phase 3 — hooks 抽取（1–2 天，一次一个，每个独立可验证）

顺序：`usePersistedState` → `useCopyFeedback`(#10) → `useGlobalHotkeys` → `useDeepLink` → `useModals` → `useRecentSkills`(#9) → `useSelection` → `useLibraryMeta` → `useSkills`(#26 的规则统一在这里落地)。

由简到繁，前六个都在 40 行以内、影响面局部；`useSkills` 放最后，因为它依赖 `lib/api` 且体量最大。**每抽一个：`npm run check` + 手动点一遍对应功能 + commit 一次**（多 commit 单 MR）。

### Phase 4 — 组件拆分（1–2 天）

先 `SkillDetail`（#5，拆成 5 个文件，它内部自洽、不牵动 App），再 `App`（#1，拆 `AppSidebar` / `DetailPane` / `ModalHost`），最后收 props（#14：`SkillList` 改收 actions 对象、`FolderPicker` 的 variant 重构 + `iconOnly` 改名 #13）。

**容纳前序改动**：如果前面维度给 `SkillDetail` 或 `SkillList` 加了新 state/prop，拆分时按同一分类归位即可——这正是 Phase 1/3 先行的意义，届时新代码大概率已经能复用 lib/hooks。

### Phase 5 — 收尾（半天）

#16（DOM 操作收口，依赖 Phase 4 拆出的 `MarkdownView`）、#15（toast 用法统一，依赖 Phase 1 的 api 层已接好错误路径）、#27（`setTimeout(0)` 收口）、#28（FolderPicker 魔数与 id）、#29（undo 校验）、#24（scripts 整理，最后做因为要等 vitest 和 typecheck 都就位）、#22 的 token 渐进替换（定规则，不强制一次改完）。

### 不建议做的事

- **不迁 TypeScript**（#19 给了替代方案）
- **不重写 FolderPicker 的定位算法**（#28，刚调对，ROI 为负）
- **不为组件写全量渲染测试**（#18，只测该测的五处）
- **不一次性替换 570 行 CSS 的所有 magic number**（#22，渐进）
