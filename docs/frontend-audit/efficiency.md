# 操作效率与工作流 审查

审查对象：`client`（React 19 + Vite）
方法：全量通读 `src/App.jsx` + `src/components/*.jsx`，对照 `server/routes/*.js` 的 API 能力核查前端暴露面。纯静态代码审查，未启动 dev server（下文所有结论均附 `文件:行` 证据；标【推测】的为未实测项）。

---

## 现状摘要

### 已有的效率资产（先记功）
- ⌘K 命令面板（`App.jsx:151-161`，`CommandPalette.jsx`），带模糊匹配 + ↑↓/Enter/Esc。
- Toast + 撤销：移动、批量移动、废纸篓均有 undo（`App.jsx:220-280`）。
- 星标乐观更新，不刷整列表（`App.jsx:206-218`）。
- 拖拽技能到文件夹（`App.jsx:340-356`，`FolderTree.jsx:158-169`）。
- 多选 Cmd/Shift 点选（`App.jsx:303-326`）+ 批量条（`SkillList.jsx:103-122`）。
- 侧栏折叠、文件栏宽度、大纲显隐持久化（`App.jsx:22-37`、`SkillDetail.jsx:247-253`）。
- 打开技能自动选中第一条，不用额外点一次（`App.jsx:107-110`）。

### 高频动作 → 当前步数 → 目标步数

| 高频动作 | 当前操作 | 当前步数 | 目标 | 差距来源 |
|---|---|---|---|---|
| 全局找某个技能 | ⌘K → 输入 → Enter（**只能搜当前文件夹内**） | 3，且常失败 | 3 且全局 | 发现 1 |
| 在列表里上下翻看 | 鼠标逐条点；键盘只能 Tab 一格一格跳 | N 次 Tab | j/k 各 1 键 | 发现 2 |
| 搜索技能 | 点搜索框 → 输入（每键一次网络 + 骨架屏闪） | 2 + 抖动 | `/` 聚焦，防抖 | 发现 3、4 |
| 打开某技能并编辑保存 | 点技能 → 点「编辑」→ 改 → 点「预览」 | 4 | ⌘E / ⌘S 各 1 | 发现 6 |
| 从详情跳到它所在目录 | 点面包屑 = **触发一次无意义的移动写库** | 坏掉 | 1 次点击导航 | 发现 5 |
| 移动 1 个技能到目录 | hover 行 → 点文件夹图标 → 搜索 → 选 | 4 | 拖拽 1 次（已有）或 ⌘K | 尚可 |
| 收藏/取消收藏 | hover → 点星 | 2 | 按 `s` | 发现 10 |
| 删除到废纸篓 | hover → 点垃圾桶 | 2 | 按 Del | 发现 10 |
| 新建技能并落到当前目录 | 点新建 → 填名 → **手动再选目录** → 填正文 → 提交 | 5+ | 4（目录默认当前） | 发现 8 |
| 把技能加进组合 | hover → 点组合图标 → 选组合（**无组合时死路**） | 3 或死路 | 3，且可当场新建 | 发现 13 |
| 组合里加技能 | 打开组合 → 添加技能 → **在全量无过滤列表里肉眼找** | 3 + 肉眼扫 | 3 + 搜索框 | 发现 14 |
| 展开一个三层嵌套目录 | 每次刷新/折叠侧栏后都要重新逐层展开 | 3 次/每次会话 | 0（记住） | 发现 7 |
| 重启后回到昨天的工作目录 | 永远回 inbox，重新点一遍 | 1-3 | 0（记住） | 发现 7 |
| 批量收藏 / 批量下载 / 批量恢复 | **不存在** | ∞ | 1 | 发现 9 |
| 复制技能（做变体） | **不存在**（后端 `POST /:id/copy` 已实现） | ∞ | 1 | 发现 15 |
| 按标签筛选 | 侧栏拉下拉 → 搜 → 选（详情里的标签不可点） | 3 | 点标签 1 次 | 发现 12 |

一句话：**「看」已经挺顺，「动」还靠鼠标 hover 精确打击；命令面板只做了导航的一半，键盘流在列表这一层断掉。**

---

## 发现（按影响排序）

### 1. ⌘K 只能搜「当前文件夹」里的技能，全局检索实际不存在
- 位置：`client/src/App.jsx:477`（`skills={skills}`）、`App.jsx:84-112`（`skills` 由 `folder=currentFolder` 拉取）
- 问题：`skills` 是当前视图的结果集。站在「收件箱」按 ⌘K 搜一个放在 `tools/xxx` 的技能 → 无结果。命令面板最核心的价值（在任何位置 3 键抵达任何技能）直接废掉。`App.jsx:479` 里那段「选中后若不在系统目录就切到 all」的补丁，正是为了绕这个问题，但因为候选集本身就不含外部技能，这段逻辑基本是死的。
- 建议：App 里单独维护一份 `allSkills`（启动时 `GET /api/skills?folder=all` 拉一次，每次 `refreshAll` 更新），只喂给 `CommandPalette`；面板项的 subtitle 已经有 `folder_path`（`CommandPalette.jsx:64`），选中时按其 `folder_path` 切视图再选中即可。
- 影响：高　工作量：小

### 2. 技能列表没有 j/k（或 ↑↓）导航，键盘流在最核心的一屏断掉
- 位置：`client/src/components/SkillList.jsx:58-63`（只处理 Enter/Space）、`SkillList.jsx:153`（每个 `li` 都 `tabIndex={0}`）
- 问题：列表是每天待最久的地方，却只能靠 Tab 一条一条挪焦点（还要穿过行内的 4 个操作按钮），或者回鼠标。对比 FolderTree 已经实现了 ↑↓←→（`FolderTree.jsx:97-136`），列表反而没有。
- 建议：在 `.skill-list-scroll` 上挂 keydown：`j`/`↓` 下移并 `onSelectSkill`（即选即预览，Linear 式）、`k`/`↑` 上移、`g g` / `G` 跳首尾、`Enter` 聚焦详情区（已有 `#skill-detail` 且 `tabIndex="-1"`，见 `App.jsx:446`）。同时把 `li` 改成 roving tabindex（仅选中项 `tabIndex=0`），Tab 一次即可跨过整个列表。
- 影响：高　工作量：中

### 3. 搜索没有防抖，每敲一个字符打一次全表 LIKE 查询
- 位置：`client/src/App.jsx:120`（`searchQuery` 进 `fetchSkills` 依赖）、`App.jsx:146-149`（`setTimeout(…, 0)` 不是防抖）、服务端 `server/routes/skills.js:73-77`（`content LIKE '%kw%'` 四字段全表扫）
- 问题：输入「playwright」= 10 次全表 `LIKE`（含 content 大字段）+ 10 次整列表重渲染。且请求无序号，慢请求后到会覆盖新结果（竞态）。
- 建议：`searchQuery` 加 250ms 防抖（或 `useDeferredValue`），并给 `fetchSkills` 加一个自增 `requestId`，回来时对不上就丢弃。
- 影响：高　工作量：小

### 4. 每次搜索/切目录都把整列表换成骨架屏，视觉上「闪烁 + 丢位置」
- 位置：`client/src/App.jsx:85`（`setLoading(true)` 无条件）、`SkillList.jsx:125-130`（loading 时整列表被骨架替换）
- 问题：配合发现 3，边打字边看到列表反复消失。本地后端往返只有几毫秒，骨架屏纯属负收益。
- 建议：只在首次加载（`skills.length === 0`）显示骨架；后续刷新保留旧列表，只在标题栏加一个细进度条或把列表 `opacity:.6`。另外 `setSelectedIds(new Set())`（`App.jsx:99,111`）会让任何一次刷新清空多选，建议改为「只保留仍存在于新结果里的 id」。
- 影响：高　工作量：小

### 5. 详情面包屑点击不是「跳转目录」，而是把技能移动到它自己的目录（写库 + 假 Toast）
- 位置：`client/src/components/SkillDetail.jsx:565`
  ```jsx
  <button className="crumb-link" onClick={() => onMoveFolder(skill.id, skill.folder_path)} title="在目录中查看">{segment}</button>
  ```
  `onMoveFolder` = `App.jsx:458` 传入的 `handleMoveSkill`（`App.jsx:221-238`）
- 问题：title 写着「在目录中查看」，实际发 `POST /api/skills/:id/move` 到**原目录**，触发 `refreshAll()` 全量刷新，再弹一条「已移动「X」到 Y」+ 撤销按钮。用户想导航，得到的是一次无意义写库 + 误导性 Toast + 列表重载。而且多层路径的每一段点了都走同一个完整 path，无法点中间层。
- 建议：改成 `onSelectFolder(arr.slice(0, i+1).join('/'))`，需要把 App 的 `handleSelectFolder` 传进 `SkillDetail`。
- 影响：高　工作量：小

### 6. 编辑态零快捷键，且切换技能会静默丢弃未保存内容
- 位置：`client/src/components/SkillDetail.jsx:530-549`（`handleSave` / `switchMode`，仅靠点「预览」触发保存）、`SkillDetail.jsx:768-775`（编辑表单，textarea 内 Enter 是换行，表单无法提交）、`client/src/App.jsx:455`（`key={selectedSkill.id}`）
- 问题：(a) 没有 ⌘S 保存、没有 ⌘E 切换编辑；(b) `key` 变化会整体重挂载 `SkillDetail`，编辑到一半点了列表另一条 → 改动无提示消失；(c) 没有 dirty 标记，用户无从知道有没有存。
- 建议：`SkillDetail` 内挂 ⌘S/Ctrl+S → `handleSave()`；⌘E 切 preview/edit；用 `dirty` 状态在「编辑」按钮上显示圆点；`dirty` 时给 window 挂 `beforeunload`，并在 App 层切换 `selectedSkillId` 前弹一次确认（或直接自动保存，与「切预览自动保存」的现有语义一致）。
- 影响：高　工作量：中

### 7. 关键视图状态不记忆：当前目录、排序、目录树展开态，每次开都要重摆一遍
- 位置：`client/src/App.jsx:40`（`currentFolder` 普通 useState，永远从 `'inbox'` 起）、`App.jsx:43`（`sortBy` 不持久化）、`client/src/components/FolderTree.jsx:55`（`useState({ ADL4: true })`）
- 问题：项目里已经有现成的 `usePersistedState`（`App.jsx:22-37`），却只用在侧栏折叠和最近列表上。更糟的是 `FolderTree` 在侧栏折叠时被整体卸载（`App.jsx:394` `{!sidebarCollapsed && <FolderTree …/>}`），折一下再展开，所有展开的目录全部收回去。另外 `{ ADL4: true }` 是硬编码的私人目录名残留。
- 建议：`currentFolder` / `currentTag` / `sortBy` / `expanded` 全部换成 `usePersistedState`；`expanded` 的初值改成 `{}` 或「自动展开当前目录的所有祖先」；侧栏折叠改成 CSS 隐藏而非卸载组件。
- 影响：高　工作量：小

### 8. 新建 / 粘贴导入不继承当前所在目录，每次都要手动再选一次
- 位置：`client/src/components/Modals.jsx:82`（`useState('inbox')`）、`Modals.jsx:168`（同）、`App.jsx:487-498`（未传当前目录）
- 问题：在 `tools/playwright` 目录下工作时点「新建」，默认仍落 inbox，之后还得再移动一次（2~4 步）。
- 建议：给两个 Modal 加 `defaultFolder` prop，App 传 `['all','starred','trash','recent'].includes(currentFolder) ? 'inbox' : currentFolder`。顺带把里面的原生 `<select>`（`Modals.jsx:134,201`）换成项目已有的可搜索 `FolderPicker`，目录一多原生下拉就难用。
- 影响：中　工作量：小

### 9. 批量操作只有「移动 + 移入废纸篓」，且单选时批量条不出现、废纸篓里批量条是错的
- 位置：`client/src/components/SkillList.jsx:56`（`selectedIds.size > 1` 才算多选）、`SkillList.jsx:103-122`（批量条只有移动/废纸篓/清除）
- 问题：
  - 缺批量收藏、批量加入组合、批量下载、**废纸篓里的批量恢复 / 批量永久删除**；
  - `isTrash` 时只隐藏了 FolderPicker，却仍显示「移入废纸篓」——对已在废纸篓的项目毫无意义；
  - 阈值 `> 1` 导致 Cmd 点选到只剩 1 个时批量条和勾选框一起消失（`SkillList.jsx:147,162` 都依赖 `multiCount > 0`），选择态反馈突然断档；
  - 没有 ⌘A 全选，没有 Esc 清空选择。
- 建议：阈值改成 `>= 1`；批量条按 `isTrash` 分两套（恢复 / 永久删除）；补批量收藏与批量加入组合（都是循环现成 API）；挂 ⌘A / Esc。
- 影响：高　工作量：中

### 10. 除 ⌘K 外没有任何全局快捷键，也没有快捷键说明入口
- 位置：`client/src/App.jsx:151-161`（全局只注册了 ⌘K 一条）；全仓 grep `keydown` 仅命中 App/FolderTree/FolderPicker/CommandPalette/Modals 各自的局部处理
- 问题：缺 `/`（聚焦搜索）、`Esc`（清搜索 / 清选择）、`s`（收藏）、`e`（编辑）、`Del`（废纸篓）、`n`（新建）、`⌘⇧F`（全局搜索）、`?`（快捷键面板）。命令面板底部虽有 `↑↓ / ↵ / Esc` 提示（`CommandPalette.jsx:169-173`），但面板外无任何键位发现路径。
- 建议：抽一个 `useGlobalHotkeys`，统一在 `input/textarea/[contenteditable]` 聚焦时跳过；加一个 `?` 触发的快捷键速查弹窗（复用 `DialogShell`）。
- 影响：高　工作量：中

### 11. 「最近浏览」两处都不准：计数被当前目录过滤，自动选中也被计入
- 位置：`client/src/App.jsx:333-336`（`recentSkillIds.map(id => skills.find(...))`，`skills` 只是当前目录）、`App.jsx:164-167`（effect 里**没有读** `userPickedRef`）、`App.jsx:46`（`userPickedRef` 声明处注释「只有用户主动点选才计入」）、`FolderTree.jsx:263`（侧栏只用 `recentSkills.length`）
- 问题：
  - `userPickedRef` 在 `App.jsx:322` 和 `:479` 被写入，但**全文没有任何地方读取它**（grep 确认）。所以 `fetchSkills` 自动选中的首条（`App.jsx:97,109`）照样进「最近浏览」——每切一次目录就污染一条。commit `d4d96cc` 想修的正是这个，但补丁没接上。
  - 侧栏那个计数因为基于当前目录的 `skills` 过滤，会随着切目录在 0~5 之间乱跳；而 `recentSkills` 这个数组除了 `.length` 之外在 `FolderTree` 里根本没被渲染，等于白传。
- 建议：effect 里改为 `if (!userPickedRef.current) return; userPickedRef.current = false;`；`recentSkills` 改用全局 `allSkills`（见发现 1）解析；侧栏要么真把最近 5 条渲染成可点列表（省掉「切到最近浏览视图」这一步），要么把计数换成 `recentSkillIds.length`。
- 影响：中　工作量：小

### 12. 标签只能从侧栏下拉筛，详情里的标签不可点
- 位置：`client/src/components/FolderTree.jsx:303-315`（标签是一个 FolderPicker 下拉）、`client/src/components/SkillDetail.jsx:733`（`skill.tags.map(tag => <span>)`，纯展示）、`SkillList.jsx` 列表行完全不显示标签
- 问题：「看到一个标签 → 想看同标签的全部」需要：记住标签名 → 滚到侧栏底部 → 点下拉 → 输入 → 选（4~5 步），而不是点一下。且列表行不显示标签，筛选前无从判断。
- 建议：详情里的 tag 改成 button → `onSelectTag(tag)`；列表行 footer 补 1~2 个 tag chip，同样可点；标题栏的 `标签：X`（`SkillList.jsx:55`）加一个 × 清除。
- 影响：中　工作量：小

### 13. 「加入组合」弹窗不能当场新建组合，无组合时是死路
- 位置：`client/src/components/Bundles.jsx:149-176`，尤其 `:172`
  ```jsx
  {!bundles.length && <span className="bundle-empty">还没有组合——先在左栏「技能组合」新建一个</span>}
  ```
- 问题：提示语本身就承认了这条死路。完整路径：关弹窗 → 侧栏找到「技能组合」→ 点 + → 命名 → 创建（此时会**自动弹出组合详情**，`App.jsx:516`）→ 关掉 → 回列表 hover 目标技能 → 点组合图标 → 选。7+ 步做一件「把这个技能放进新组合」的事。
- 建议：弹窗底部加「＋ 新建组合并加入」——输入名字 → `POST /api/bundles` → 拿到 id 直接 `POST /:id/skills`，一步完成。
- 影响：中　工作量：小

### 14. 组合详情的「添加技能」是一面无过滤、无多选的全量技能墙
- 位置：`client/src/components/Bundles.jsx:40-47`（`GET /api/skills?folder=all` 全量）、`Bundles.jsx:101-110`（`allSkills.filter(...).map(...)` 直接铺按钮，点一个只加一个）
- 问题：技能上百条时只能靠眼睛扫 + 滚动；组一个 8 个技能的 bundle = 8 次「滚动定位 + 点击」。
- 建议：加搜索输入框（复用 `CommandPalette.jsx:5-27` 的 `fuzzyScore`）+ 复选多选 + 「添加选中项」一次提交；或者允许从主列表多选后直接批量加入组合（与发现 9 合并做）。
- 影响：中　工作量：中

### 15. 后端已实现的能力没有前端入口：复制技能、重命名组合
- 位置：`server/routes/skills.js:332`（`POST /api/skills/:id/copy`）、`server/routes/bundles.js:50`（`PUT /api/bundles/:id`）；客户端 grep 两者均无调用（`client/src` 内 `api/skills/.*copy` 零命中）
- 问题：「基于现有技能做一个变体」是技能管理最常见的动作之一，现在只能手动：打开 → 全选正文 → 复制 → 新建 → 粘贴 → 改名（6+ 步），而后端一行 API 就能搞定。组合建错名字则完全无法改，只能删了重建再把成员一个个加回去。
- 建议：技能行操作区 / ⌘K 加「复制技能」（复制后自动选中新建项并进入编辑）；组合详情标题加内联重命名。
- 影响：中　工作量：小

### 16. 拖拽只支持「技能 → 自定义文件夹」，拖到收藏/废纸篓/收件箱/组合都不行
- 位置：`client/src/components/FolderTree.jsx:179`（`dropHandlers` 只挂在 `.folder-row` 上）、`FolderTree.jsx:237-265`（navItems 与「最近浏览」无任何 drop 处理）、`FolderTree.jsx:288-295`（bundle 项同样无 drop）
- 问题：拖拽这条最快的路径只覆盖了一半场景。「拖到废纸篓删除」「拖到收藏加星」「拖到组合里」都是零学习成本的直觉操作，现在全靠 hover 精确点小图标。
- 建议：给 4 个 navItem 和每个 bundle 项加 `dropHandlers`，按目标 id 分派到 `handleMoveSkill` / `handleToggleStar` / `handleTrashSkill` / 加入组合；`handleDropOnFolder`（`App.jsx:341-356`）已经解析了 `text/skill-ids` 多选负载，直接复用。
- 影响：中　工作量：中

### 17. 没有右键菜单，所有行级操作都锁在 hover 后的小图标上
- 位置：`client/src/index.css:237-238`（`.row-actions { opacity: 0 }`，仅 `:hover`/`:focus-within` 显形）、`SkillList.jsx:178-200`（4 个 16px 图标挤在 footer 右侧）、`FolderTree.jsx:202-219`（目录操作要先点「…」再点菜单项 = 2 步）
- 问题：图标全靠 title 区分，hover 才出现意味着「先把鼠标移到正确的行 → 等图标淡入 → 再精确命中 1.6rem 的按钮」。键盘用户则需要 `focus-within`，配合发现 2 的缺失基本不可达。
- 建议：给 `.skill-row` 和 `.folder-row` 加 `onContextMenu` 右键菜单（移动到…/收藏/加入组合/复制/下载/删除；目录：新建子目录/重命名/删除），菜单项带快捷键提示，顺便解决发现 10 的可发现性。
- 影响：中　工作量：中

### 18. 目录新建/重命名用 `window.prompt`，删除用 `window.confirm`，且删除无撤销
- 位置：`client/src/components/FolderTree.jsx:138-142`（`window.prompt`）、`:144-150`（`window.prompt`）、`:152-156`（`window.confirm`）、`client/src/App.jsx:283`（永久删除的 `window.confirm`）
- 问题：`prompt` 阻塞主线程、无法校验非法字符、无法预填父路径提示、样式与深色 UI 完全割裂；`confirm` 打断心流。项目其他地方（移动/废纸篓）已经改成了「先执行 + Toast 撤销」的现代范式（`App.jsx:240-248` 注释「C1: 去掉 confirm」），目录操作却停在旧范式。删除目录会把内含技能全退回 inbox（`server/routes/folders.js:121+`），这个后果比移动大得多，却只有一个 confirm、没有撤销。
- 建议：改成树内联编辑（双击目录名就地改名，新建时在树上插入一个待输入行）；删除目录改为 Toast + 撤销（撤销 = 重建目录 + 把这批技能移回去，需记录受影响 id）。永久删除保留 confirm（确实不可逆）。
- 影响：中　工作量：中

### 19. Shift 范围选的锚点在 Cmd 点选后不更新，范围会从错误的位置起算
- 位置：`client/src/App.jsx:304-326`
  ```js
  if (event && (event.metaKey || event.ctrlKey)) { ...setSelectedIds...; return; }   // ← 提前 return，未更新 lastSelectedIndex
  if (event && event.shiftKey && lastSelectedIndex != null) { ... }
  ```
- 问题：Cmd 点第 5 条 → Shift 点第 9 条，期望选 5~9，实际从上一次**普通点击**的位置起算。而且 Shift 分支里整个 `setSelectedIds(new Set(...))` 会**覆盖**已有选择（不是并集），Cmd 攒了一半的选择会被 Shift 一键清掉。
- 建议：Cmd 分支里同步 `setLastSelectedIndex(currentIdx)`；Shift 分支改为在现有集合上并入区间（`new Set([...prev, ...range])`）。
- 影响：中　工作量：小

### 20. URL 不反映当前状态，浏览器前进/后退完全失效
- 位置：`client/src/App.jsx:127-144`（只在启动时读一次 `?skill=`，之后再没有任何 `history.pushState` / `replaceState`）
- 问题：无法「后退回上一个看过的技能」（桌面端这是免费的一键回退）；无法把某个目录视图固定为浏览器书签/固定标签页；开两个窗口对照两个技能也做不到（都指向同一个 URL）。
- 建议：`selectedSkill` / `currentFolder` / `currentTag` 变化时 `history.replaceState`（同技能内的筛选变化）或 `pushState`（切换技能），并监听 `popstate` 还原。改动很小，收益是每天若干次的「返回上一个」。
- 影响：中　工作量：小

### 21. 命令面板只会「导航」，不会「操作」
- 位置：`client/src/components/CommandPalette.jsx:79-87`（全部命令仅 7 条：收件箱/全部/收藏/新建/粘贴/终端接入/收起侧栏）
- 问题：缺「废纸篓」「最近浏览」「新建文件夹」「新建组合」「打开某组合」「切换排序」；更缺**对当前选中技能的动作**：收藏 / 移动到…（二级选目录）/ 加入组合 / 复制 Agent 指令 / 下载 / 移入废纸篓 / 查看历史版本。目前这些动作 100% 依赖鼠标 hover。
- 建议：补齐导航命令（几行）；引入「上下文动作」分组——面板打开时若有 `selectedSkill`，置顶显示 `对「X」：收藏 / 移动到… / 加入组合 / 复制指令 / 删除`；「移动到…」用面板内二级模式（输入目录名再 Enter），不必另开弹窗。
- 影响：中　工作量：中

### 22. 星标后列表不重排、收藏视图里取消收藏的项不消失
- 位置：`client/src/App.jsx:206-218`（成功后只 `fetchFoldersAndStats()`，注释明确「不重载列表」）
- 问题：乐观更新避免闪烁是对的，但副作用是：站在「收藏」视图里取消一个收藏，它仍然赖在列表里，直到下一次切目录才消失——用户会怀疑操作没生效，往往再点一次（反而变成重新收藏）。
- 建议：在 `currentFolder === 'starred'` 且取消收藏时，本地把该行从 `skills` 里移除（仍然是纯本地、无闪烁），并在 Toast 里给「撤销」。其余视图维持现状。
- 影响：中　工作量：小

### 23. 侧栏一折叠，「新建 / 粘贴导入 / 终端接入」全部消失
- 位置：`client/src/App.jsx:394-415`（`{!sidebarCollapsed && <FolderTree …/>}`）、`FolderTree.jsx:228-232`（三个快捷按钮在 FolderTree 内部）
- 问题：折叠侧栏（为了给正文腾宽度，是常态）后，新建技能只剩 ⌘K 一条路，目录导航也完全不可用；再展开时目录展开态全丢（同发现 7）。
- 建议：把三个高频动作提到永远可见的位置（列表面板标题栏的 `+` 按钮，或详情工具栏）；折叠态侧栏保留一条图标轨道（收件箱/收藏/全部/废纸篓 + 新建），参考详情区已有的 `file-sidebar-rail` 实现（`SkillDetail.jsx:602-613`）。
- 影响：中　工作量：中

### 24. 附属文件（scripts / references）只能看不能改，也不能单独下载
- 位置：`client/src/components/SkillDetail.jsx:704-727`（非 SKILL.md 一律走只读 viewer）、`SkillDetail.jsx:768-775`（编辑表单只绑 `content` 即 SKILL.md）；服务端也只有 `GET /:id/file`，无 PUT
- 问题：改一行 `scripts/run.sh` 必须：下载 tar.gz → 解压 → 编辑 → `ash push` 整个目录。对一个「本地技能管理工具」来说这是最刺眼的缺口。
- 建议：先补一个「复制整个文件内容」和「下载此文件」按钮（纯前端，成本极低）；中期补 `PUT /api/skills/:id/file` + viewer 内可编辑（与 SKILL.md 共用编辑器和版本快照机制）。
- 影响：中　工作量：大（完整编辑）/ 小（复制+下载按钮）

### 25. 缺少「复制 slug / 复制本地路径」这类一键取值
- 位置：`client/src/components/SkillDetail.jsx:516-518`（只生成 agentPrompt 和 cliCommand 两种文本）
- 问题：给 Agent 写 prompt 时经常只需要 `slug` 或 `folder_path/slug`，现在只能从面包屑（`SkillDetail.jsx:570`）手选文本复制，选中小号等宽字体很容易选歪。
- 建议：面包屑的 `crumb-current` 点击即复制 slug（带 Toast 反馈）；操作区的下载按钮旁加一个溢出菜单，放「复制 slug / 复制仓库路径 / 复制 Markdown 链接」。
- 影响：低　工作量：小

### 26. 历史版本：无内容预览、无 diff，恢复即时生效
- 位置：`client/src/components/Modals.jsx:254-337`，尤其 `:273-287`（`restore` 直接 POST）、`:299-306`（每行只有来源/时间/大小/标签）
- 问题：只靠「时间 + KB 数」根本无法判断该恢复哪个版本，实际用法只能是「恢复 → 看 → 不对 → 再恢复」，每轮 2~3 步且反复写库。
- 建议：行内加展开预览（`GET` 该版本内容后渲染）；至少提供与当前版本的行级 diff（`diff` 库或简易 LCS）。标签输入框现在只有 Enter 生效且无成功反馈（`Modals.jsx:313-322`），补一个 ✓ 按钮 + Toast。
- 影响：低　工作量：中

### 27. 弹窗里 ⌘Enter 不能提交，新建组合连 Enter 都不行
- 位置：`client/src/components/Modals.jsx:127`（form）+ `:138`（textarea 内 Enter 是换行，无 ⌘Enter 处理）、`Modals.jsx:197-203`（同）、`client/src/components/Bundles.jsx:136-142`（根本不是 `<form>`，只有按钮 onClick）
- 问题：粘贴导入的典型动线是「⌘V → 提交」，现在必须从键盘挪到鼠标点「导入技能」。新建组合输完名字按 Enter 无反应。
- 建议：`DialogShell` 统一挂 `⌘/Ctrl+Enter` → 提交当前 form；`NewBundleModal` 改成 `<form onSubmit>`。
- 影响：低　工作量：小

### 28. 导入只有「粘贴」一条路，不支持拖文件/文件夹进窗口
- 位置：`client/src/components/Modals.jsx:166-206`（PasteSkillModal 是唯一的 Web 导入入口）；应用根节点 `App.jsx:359` 无任何 drop 处理
- 问题：手上有一个 `SKILL.md` 文件时，得「用编辑器打开 → 全选 → 复制 → 回浏览器 → 点粘贴导入 → 粘贴 → 选目录 → 提交」（7 步），或者切到终端用 `ash push`。
- 建议：给 `.app-shell` 加全局 dragover/drop：拖入 `.md` → 读文本后直接走 `parseSkillMarkdown`（`Modals.jsx:146-164` 已有）+ 落到当前目录；拖入 `.tar.gz` / 目录 → 走 push 通道。影响面小、每次省 5 步。
- 影响：低　工作量：中

### 29. Toast 撤销窗口 5 秒、最多叠 3 条，批量操作容易来不及撤销
- 位置：`client/src/components/Toast.jsx:17`（`duration = 5000`）、`Toast.jsx:19`（`[...prev.slice(-2), …]` 最多 3 条）
- 问题：批量移动 20 个技能后，确认「移错了」往往要先去目标目录看一眼——5 秒不够；且快速连做几个操作会把前面可撤销的 Toast 挤掉，撤销机会静默消失。
- 建议：带 `actionLabel` 的 Toast 延长到 10s；hover 时暂停计时；被挤出的带撤销 Toast 记入一个 `⌘Z` 撤销栈（哪怕只保留最近 1 条）。
- 影响：低　工作量：小

### 30. 列表未虚拟化，全量渲染
- 位置：`client/src/components/SkillList.jsx:144-206`（`skills.map` 全量渲染，每行含 4 个按钮 + 一个 `FolderPicker` 组件实例）
- 问题：每一行都挂了一个完整的 `FolderPicker`（`SkillList.jsx:181-189`），组件里有 useMemo/useEffect/portal 逻辑。技能上几百条时，输入搜索的每一次重渲染成本都乘以行数——会直接反噬发现 3/4 的手感。【推测：未实测，需用真实数据量验证】
- 建议：先把行内 `FolderPicker` 改成「点击图标时才挂载」（lazy），成本最低；数据量确实上去了再考虑 `react-window`。
- 影响：低　工作量：中

---

## 建议的实施顺序

**第 1 批 —— 改动都在 10 行内，当天可全部做完，收益最大**
1. 发现 5：面包屑改成导航（这是个真 bug，每次点都在写库）
2. 发现 3 + 4：搜索防抖 + 竞态守卫 + 不再无条件骨架屏
3. 发现 1：给命令面板喂全局 `allSkills`
4. 发现 7：`currentFolder`/`sortBy`/`expanded` 走 `usePersistedState`，清掉硬编码 `ADL4`
5. 发现 11：接上 `userPickedRef`，修「最近浏览」计数
6. 发现 8：新建/导入继承当前目录
7. 发现 19：多选锚点 + Shift 并集
8. 发现 22：收藏视图取消收藏后本地移除

**第 2 批 —— 键盘流补完（这是「每天省一半鼠标」的一批）**
9. 发现 2：列表 j/k + roving tabindex
10. 发现 10：全局快捷键表（`/` `Esc` `s` `e` `Del` `n` `?`）+ `?` 速查弹窗
11. 发现 6：⌘S / ⌘E + dirty 标记 + 切换技能不丢改动
12. 发现 21：命令面板补导航命令 + 当前技能的上下文动作
13. 发现 27：⌘Enter 提交

**第 3 批 —— 批量与直接操作**
14. 发现 9：批量条阈值/废纸篓分支/批量收藏/批量加入组合/⌘A
15. 发现 16：navItems + bundle 支持拖放
16. 发现 17：右键菜单（技能行 + 目录行）
17. 发现 12：标签可点筛选
18. 发现 13 + 14：组合弹窗可当场新建；组合添加技能加搜索与多选
19. 发现 15：复制技能、重命名组合（后端已就绪）

**第 4 批 —— 体验补完 / 可延后**
20. 发现 18：目录内联编辑 + 删除可撤销
21. 发现 20：URL 同步 + 前进后退
22. 发现 23：折叠态侧栏保留图标轨道
23. 发现 24：附属文件先加「复制/下载」，编辑能力另开
24. 发现 25 / 26 / 28 / 29 / 30

> 提醒：第 1 批里的发现 5、11、19 属于「功能没按注释/commit 声明的方式工作」，本质是 bug 而非优化，建议单独 commit 便于回溯。
