# 感知性能 + 状态持久化 审查

审查对象：`仓库根目录`（client React 19 + Vite，server Express）
审查方式：通读 `client/src/App.jsx`、`client/src/components/*.jsx`、`server/routes/*.js`；启动 `server/index.js` 实测 `/api/skills` 响应（7 条技能 / 5.5KB / 5ms）。浏览器交互未逐条实操——**下文结论均来自代码证据，标注为【事实】；涉及主观体感的标【推测】**。

---

## 现状摘要

### 一句话结论

星标是唯一做了乐观更新的写操作；**其余所有写操作都走 `runMutation → refreshAll`，即「等请求 → 重拉整个列表 + 左栏 4 个接口 → `loading=true` 把列表换成骨架屏」**，代价是列表闪烁、滚动位置归零、选中技能可能被重置。状态持久化侧只做了 4 项（侧栏折叠、最近浏览、文件栏宽度、大纲显隐），**当前文件夹 / 标签 / 搜索词 / 排序 / 选中技能全部不持久化也不进 URL**，刷新即回到「收件箱 + 第一个技能」，浏览器前进后退完全无效。

### 表 1：写操作 → 是否乐观更新 → 是否回滚

| 写操作 | 入口 | 乐观更新 | 失败回滚 | 副作用 |
|---|---|---|---|---|
| 星标切换 | `App.jsx:206-218` | ✅ 是 | ✅ 有（`setSkills(prev)`） | 仅刷左栏计数，不重拉列表 |
| 移动技能（拖拽/选择器） | `App.jsx:221-238` | ❌ 否 | ❌ 无（失败仅 Toast） | `refreshAll`：5 个请求 + 骨架闪 |
| 移入废纸篓 | `App.jsx:241-248` | ❌ 否 | ❌ 无 | 同上；Toast 在刷新完成后才出现 |
| 恢复技能 | `App.jsx:433` | ❌ 否 | ❌ 无 | 同上 |
| 永久删除 | `App.jsx:282-285` | ❌ 否 | ❌ 无 | `window.confirm` 阻塞 + 全量刷新 |
| 批量移动 | `App.jsx:251-269` | ❌ 否 | ❌ 无，且**吞错**（`.catch(() => null)`） | N 个并发请求，无进度，失败也报成功 |
| 批量废纸篓 | `App.jsx:271-280` | ❌ 否 | ❌ 无，同样吞错 | 同上 |
| 新建技能 | `App.jsx:287-295` | ❌ 否 | — | 全量刷新；弹窗草稿不清空（见发现 13） |
| 粘贴导入 | `App.jsx:497`→`handleCreateSkill` | ❌ 否 | — | 同上 |
| 编辑保存（SKILL.md） | `App.jsx:297-301` | ❌ 否 | ❌ 无 | 全量刷新，整列表闪骨架 |
| 新建/重命名/删除文件夹 | `App.jsx:190-204` | ❌ 否 | ❌ 无 | `window.prompt`/`confirm` + 全量刷新 |
| 组合：加入/移除/删除 | `Bundles.jsx:26-57`、`App.jsx:505-517` | ❌ 否 | ❌ 无（`fetch` 无 `res.ok` 检查） | 组合详情全量 `load()` + `fetchFoldersAndStats()` |
| 版本恢复 | `Modals.jsx:273-287`、`SkillDetail.jsx:596-599` | ❌ 否 | ❌ 无 | 恢复后只回填 `content`，name/description/列表不同步 |
| 版本打标签 | `Modals.jsx:313-322` | ❌ 否 | ❌ 无（完全不判错） | 回车后重拉整个版本列表 |

### 表 2：状态 → 是否持久化 → 建议

| 状态 | 当前位置 | 持久化 | URL | 建议 |
|---|---|---|---|---|
| 侧栏折叠 | `App.jsx:44` | ✅ `ash:sidebar-collapsed` | ❌ | 保持 |
| 最近浏览 id | `App.jsx:45` | ✅ `ash:recent-skills` | ❌ | 保持，但修数据污染（发现 9） |
| 详情文件栏宽度 | `SkillDetail.jsx:248-251,278-280` | ✅ `ash:file-sidebar-width` | ❌ | 保持 |
| 大纲显隐 | `SkillDetail.jsx:253,282-284` | ✅ `ash:outline-hidden` | ❌ | 保持 |
| **当前文件夹** | `App.jsx:40` | ❌ | ❌ | localStorage + `?folder=` |
| **当前标签** | `App.jsx:41` | ❌ | ❌ | `?tag=` |
| **搜索词** | `App.jsx:42` | ❌ | ❌ | `?q=`（replaceState，不入历史） |
| **排序方式** | `App.jsx:43` | ❌ | ❌ | localStorage 即可 |
| **选中技能** | `App.jsx:53` | ❌ | 只读不写（`App.jsx:127-144`） | `?skill=<slug>` 双向同步 |
| 多选集合 | `App.jsx:54` | ❌ | ❌ | 不必持久化（会话态，合理） |
| 列表滚动位置 | 无（`SkillList.jsx:124`） | ❌ | ❌ | sessionStorage 按 folder 记录 + 刷新后恢复 |
| 详情当前文件（tab） | `SkillDetail.jsx:236` | ❌ | ❌ | 按 skillId 存 Map，返回时恢复 |
| 详情文件树展开节点 | `SkillDetail.jsx:246` | ❌ | ❌ | 同上 |
| 文件过滤词 | `SkillDetail.jsx:260` | ❌ | ❌ | 会话内保留即可 |
| 左栏文件夹展开节点 | `FolderTree.jsx:55`（硬编码 `{ADL4:true}`） | ❌ | ❌ | localStorage + 去掉硬编码 |
| 详情 preview/edit 模式 | `SkillDetail.jsx:231` | ❌ | ❌ | 不必持久化，但要护住草稿 |
| **编辑器未保存草稿** | `SkillDetail.jsx:232-234` | ❌ | ❌ | 按 skillId 存 localStorage 草稿 + 恢复提示 |
| 新建/导入弹窗草稿 | `Modals.jsx:80-87,167-171` | ❌（靠组件常驻侥幸保留，刷新即丢） | ❌ | 存 localStorage + 提交成功后显式清空 |
| 命令面板历史/最近命令 | 无 | ❌ | ❌ | 存最近 5 条执行项，置顶显示 |
| 侧栏宽度 | 不可调（`index.css:106-114` 固定 grid） | ❌ | ❌ | 可选：加 resizer + 持久化 |
| 窗口/视口偏好 | 无 | ❌ | ❌ | 单人本地场景优先级低 |

---

## 发现（按影响排序）

### 1. 搜索每敲一个字符就全量重拉列表，并把列表整体换成骨架屏

- 位置：`client/src/App.jsx:84-120`、`App.jsx:146-149`、`client/src/components/SkillList.jsx:78-84`、`SkillList.jsx:125-130`
- 问题：【事实】`onSearchChange` 直接 `setSearchQuery`（`SkillList.jsx:82`），`searchQuery` 是 `fetchSkills` 的依赖（`App.jsx:120`），effect 里 `setTimeout(fetchSkills, 0)` 等于零防抖（`App.jsx:147`）。`fetchSkills` 第一行就 `setLoading(true)`（`App.jsx:85`），`SkillList` 在 `loading` 时用骨架屏**替换整个 `<ul>`**（`SkillList.jsx:125-130`）。所以输入「debug」= 5 次请求 + 5 次「列表→骨架→列表」闪烁，滚动位置每次归零。服务端还是 `content LIKE '%kw%'` 全表扫（`server/routes/skills.js:73-77`）。
- 建议：① 搜索词加 200~250ms 防抖（或用 `useDeferredValue`）；② `fetchSkills` 区分「首屏 loading」和「刷新中 refreshing」——只有 `skills.length === 0` 时才显示骨架，否则保留旧列表并在工具栏加一个细进度条 / 半透明遮罩；③ 本地列表已带 `content` 字段，短查询（<2 字符）可先做前端过滤，命中后再发请求。
- 影响：高　工作量：小

### 2. 所有写操作后都 `refreshAll()`，一次操作触发 5 个请求 + 整页级刷新

- 位置：`client/src/App.jsx:169-183`（`refreshAll` / `runMutation`）、`App.jsx:67-82`（`fetchFoldersAndStats` 并发 4 个接口）
- 问题：【事实】`runMutation` 默认 `refresh = true`，任何移动/删除/重命名/新建/保存都会跑 `fetchSkills + /api/folders + /api/skills/stats + /api/skills/tags + /api/bundles` 共 5 个请求，且 `fetchSkills` 会 `setLoading(true)` 触发骨架闪烁（见发现 1）。删一个技能要等两个串行 round trip 才看到结果。
- 建议：把 `refreshAll` 拆成「局部失效」：移动/删除只需改本地 `skills` 数组 + 刷新 `stats/folders` 计数；`tags`/`bundles` 只在真正可能变化时刷（新建/导入技能、组合增删）。给 `runMutation` 增加 `{ patch: (skills) => nextSkills }` 参数做乐观更新，失败时用闭包里的旧数组回滚（照抄 `handleToggleStar` 的写法）。
- 影响：高　工作量：中

### 3. 除星标外全部写操作无乐观更新、也无回滚

- 位置：`client/src/App.jsx:206-218`（唯一的乐观实现）对照 `App.jsx:221-302`
- 问题：【事实】`handleToggleStar` 已经写好了「先改本地 → 失败 `setSkills(prev)` 回滚」的样板，但 `handleMoveSkill` / `handleTrashSkill` / `handleCreateSkill` / `handleSaveSkill` 全部是「等请求 → 全量刷新」。本地单人场景请求只要几毫秒，但加上 5 个请求串行和骨架重绘，体感仍是「卡一下」。
- 建议：优先给三个高频操作补乐观更新：移入废纸篓（本地直接从数组移除）、移动（本地改 `folder_path`，若当前是具体文件夹视图则移除该行）、保存（本地 patch `name/description/content/updated_at`）。统一抽一个 `optimistic(mutateLocal, request)` 小工具，失败时恢复快照 + Toast，不引入额外抽象层。
- 影响：高　工作量：中

### 4. 列表刷新会把选中技能悄悄换成 `list[0]`，详情区跳走

- 位置：`client/src/App.jsx:95-98`、`App.jsx:107-110`
- 问题：【事实】`setSelectedSkillId(previousId => 在新列表里找不到就取 list[0]?.id)`。于是：删掉当前技能后详情跳到列表第一条（不是相邻那条）；搜索时旧选中被过滤掉，详情立刻换成搜索结果第一条；移动技能到别的文件夹后，当前文件夹视图里它消失，详情又跳走。用户视线被强行拽走。
- 建议：删除场景选「原位置的下一条，没有则上一条」；搜索/筛选场景**保留当前选中**（详情区不动），只在用户点击新行时才切换；找不到时宁可保留上一次的详情快照 + 顶部提示「该技能不在当前筛选中」。
- 影响：高　工作量：小

### 5. 编辑模式每次按键都同步跑 `marked.parse` + highlight.js 全文高亮（预览根本不可见）

- 位置：`client/src/components/SkillDetail.jsx:371-374`、`SkillDetail.jsx:363-369`、`SkillDetail.jsx:214-228`、`SkillDetail.jsx:400-430`
- 问题：【事实】`renderedMarkdown` 的 `useMemo` 依赖 `content`，**没有按 `mode` 做条件**；编辑模式下 textarea 每次 `onChange`（`SkillDetail.jsx:773`）都会触发 `marked.parse` → `highlightMarkdownHtml`（建临时 DOM、遍历所有 `pre>code` 逐块 hljs 高亮）→ `extractHeadings` 重算 → 再触发 `SkillDetail.jsx:400` 的 DOM 补丁 effect（依赖 `renderedMarkdown`）做两轮 `querySelectorAll`。全部在主线程同步执行，而结果在编辑模式下压根不渲染。
- 建议：① `useMemo` 加 `mode === 'preview'` 短路（`mode !== 'preview' ? '' : ...`）；② 把 `content` 用 `useDeferredValue` 包一层再喂给渲染管线；③ `SkillDetail.jsx:400` 和 `:433` 两个 effect 增加 `mode === 'preview'` 早退。
- 影响：高（大 SKILL.md 下是明确的输入卡顿）　工作量：小

### 6. 无请求取消，快速切换文件夹/搜索会出现「后发先至」的错乱列表

- 位置：`client/src/App.jsx:84-120`、`App.jsx:146-149`、`SkillDetail.jsx:315-334`
- 问题：【事实】`fetchSkills` 内部没有 `cancelled` 标志也没有 `AbortController`，effect 的 cleanup 只清了 `setTimeout`（`App.jsx:148`）。先点 A 文件夹再快速点 B，若 A 的响应后到，`setSkills` 会把 A 的结果盖到 B 视图上。对比 `SkillDetail.jsx:331-333` 已经正确用了 `cancelled` 标志——App 层缺这一层。
- 建议：`fetchSkills` 内维护一个递增 `requestIdRef`，响应回来时比对；或直接用 `AbortController` + effect cleanup abort。
- 影响：高（数据正确性）　工作量：小

### 7. 面包屑点击触发一次无意义的写请求 + 全量刷新 + 误导性「已移动」Toast

- 位置：`client/src/components/SkillDetail.jsx:563-568`（`onClick={() => onMoveFolder(skill.id, skill.folder_path)}`），链到 `App.jsx:221-238`
- 问题：【事实】面包屑的 `title` 是「在目录中查看」，但它调用的是 `handleMoveSkill(skillId, 当前folder_path)` —— 把技能「移动到它自己所在的目录」。结果：一次 POST `/api/skills/:id/move` 写库、一次 `refreshAll`（5 请求 + 骨架闪）、一条「已移动「X」到 xxx」的 Toast 带「撤销」按钮，而用户期待的只是导航。
- 建议：改成 `onSelectFolder(segmentPath)`（需要把 `handleSelectFolder` 透传进 `SkillDetail`），纯导航零写操作；顺手支持点击多级路径中的任一段。
- 影响：高（功能错 + 感知噪音）　工作量：小

### 8. 状态几乎不进 URL：只在启动时读一次 `?skill=`，从不写回；前进后退完全失效

- 位置：`client/src/App.jsx:127-144`（唯一的 URL 读取）；全仓无 `history.pushState` / `replaceState` / `popstate`（已全局 grep 确认）
- 问题：【事实】① 选中技能不会写进地址栏 → 刷新后回到「收件箱 + 第一个技能」；② 无法用 URL 直接打开某个文件夹或某个搜索；③ 浏览器「后退」直接离开应用，而不是回到上一个技能/文件夹；④ `?skill=` 的处理还会和首屏 `inbox` 拉取并发，造成一次额外的双重请求（`App.jsx:122-149` 两个 effect 同时跑）。
- 建议：用一个轻量 `syncUrl` effect 把 `{folder, tag, q, sort, skill}` 以 `replaceState` 写进 query（避免每次输入都塞历史栈；技能切换用 `pushState`），启动时统一从 URL 初始化，再加 `popstate` 监听恢复。不需要引入 react-router——单页三栏，手写 30 行足够。
- 影响：高　工作量：中

### 9. 「最近浏览」被自动选中污染，`userPickedRef` 是死代码

- 位置：`client/src/App.jsx:46`（`userPickedRef` 声明）、`App.jsx:164-167`（记录 effect）、`App.jsx:322`、`App.jsx:479`（两处置位）
- 问题：【事实】注释写着「只有用户主动点选才计入最近浏览」，`userPickedRef` 也在 `handleSelectSkill` 和命令面板里被置 `true`，但 `App.jsx:164-167` 的 effect **完全没读这个 ref**，任何 `selectedSkillId` 变化都会写入最近列表——包括 `fetchSkills` 自动选中的 `list[0]`（`App.jsx:98/110`）。切一次文件夹就污染一条。该 ref 从未被读取，是死代码。
- 建议：effect 里加 `if (!userPickedRef.current) return;`，并在写入后复位 `userPickedRef.current = false`；或者干脆把「记录最近」挪进 `handleSelectSkill` / 命令面板回调，删掉这个 effect 和 ref。
- 影响：高（持久化数据长期错）　工作量：小

### 10. 编辑草稿零保护：切技能即丢、刷新即丢、无任何提示

- 位置：`client/src/App.jsx:453-459`（`<SkillDetail key={selectedSkill.id}>`）、`SkillDetail.jsx:232-234`（本地 state）、`SkillDetail.jsx:537-549`（`switchMode`）、`SkillDetail.jsx:773`
- 问题：【事实】`key={selectedSkill.id}` 让切换技能时 `SkillDetail` 整体卸载重挂，`content/name/description` 三个 state 归零，未保存内容**静默丢失且没有任何确认**。只有「切回预览」这一条路径会自动保存（`SkillDetail.jsx:539-545`）。刷新页面、关标签页同样丢（无 `beforeunload`）。
- 建议：① 处于 `mode === 'edit'` 且 dirty 时，每 ~500ms 防抖写 `localStorage['ash:draft:<skillId>']`；重新进入该技能时检测到草稿则顶部显示「有未保存草稿 [恢复] [丢弃]」；② 在 `handleSelectSkill` 前置一个 dirty 检查，dirty 时先自动保存或弹确认；③ 加 `beforeunload` 守卫（仅 dirty 时注册）。
- 影响：高（会丢用户数据）　工作量：中

### 11. 列表滚动位置在每次刷新/搜索后归零

- 位置：`client/src/components/SkillList.jsx:124-130`、`index.css:219`（`.skill-list-scroll { overflow-y: auto }`）
- 问题：【事实】`loading` 为真时 `<ul class="skill-list">` 被骨架 `<div>` 整体替换，DOM 销毁 → 滚动容器内容高度归零 → 恢复后滚到顶部。因为每次写操作都 `refreshAll`（发现 2）、每次按键都重拉（发现 1），滚动位置实际上几乎不可能保住。技能多时，删完一个要重新滚回去。
- 建议：先修发现 1/2 的「刷新时不换骨架」；再补一层按 folder 记录 `scrollTop` 的 sessionStorage 恢复（切回文件夹时还原）。
- 影响：高　工作量：小（依赖发现 1、2 先修）

### 12. 详情区文件栏「迟到」造成正文横向抖动

- 位置：`client/src/components/SkillDetail.jsx:315-334`（挂载后拉 `/api/skills/:id` 才拿到 `file_tree`）、`SkillDetail.jsx:602-661`（`fileTree.length > 1` 才渲染左侧文件栏）、`server/routes/skills.js:57`（列表接口已返回 `content` 但不返回 `file_tree`）、`server/routes/skills.js:121`
- 问题：【事实】列表接口已经带 `content`，所以正文能立刻渲染（这点是好的，避免了白屏）；但 `file_tree` 只有单条详情接口才有，于是「正文先按全宽渲染 → 详情请求回来 → 左侧多出 240px 文件栏 → 正文整体右移并重排」。多文件技能每次点击都抖一下。
- 建议：① 列表接口顺带返回 `file_count`（`server/routes/skills.js:95-98` 处 map 时加），前端据此**预留**文件栏位置（先渲染骨架栏）；② 或对已访问过的技能把 `file_tree` 缓存在内存 Map 里，二次进入零抖动。
- 影响：中　工作量：小

### 13. 新建/粘贴导入弹窗提交成功后不清空，下次打开残留上次草稿

- 位置：`client/src/components/Modals.jsx:104-123`（`handleSubmit` 里 `if (created) onClose()`，无任何 reset）、`Modals.jsx:180-193`、对照 `Bundles.jsx:131`（`NewBundleModal` 正确地 `setName('')`）
- 问题：【事实】`NewSkillModal` / `PasteSkillModal` 在 `App.jsx:487-498` 是常驻挂载的（`isOpen` 为假时 `return null` 在 hooks 之后，组件实例不卸载），所以 `name/slug/tags/content/rawText` 会一直留着。创建成功后再点「新建技能」，表单里是上一个技能的全文，用户很容易在没注意的情况下基于旧内容再建一个。
- 建议：提交成功后显式重置全部字段（`setName('')`、`setSlug('')`、`setTags([])`、`setContent(defaultContent)`、`setRawText('')`、`setParsedInfo(null)`、`setError('')`）。**注意**：取消/误关时相反，应保留（见发现 14）。
- 影响：中　工作量：小

### 14. 弹窗误关无确认；草稿只靠「组件常驻」侥幸留存，刷新即丢

- 位置：`client/src/components/Modals.jsx:30`（Escape 立即 `onClose()`）、`Modals.jsx:53`（背景 mousedown 立即关闭）
- 问题：【事实】粘贴了 200 行 SKILL.md，误触 Esc 或点到遮罩就直接关了，没有任何确认。当前能「再打开还在」纯属组件没卸载的副作用（见发现 13），不是设计；刷新页面就彻底没了。
- 建议：给 `DialogShell` 增加 `dirty` 与 `onRequestClose` 两个可选 prop：dirty 时 Esc/点遮罩改为提示「草稿已保留，确认关闭？」或直接关闭但 Toast 提示「草稿已保存，可从『新建技能』继续」；同时把 `rawText/content` 防抖写进 `localStorage['ash:draft:new-skill']`，打开时回填。
- 影响：中　工作量：小

### 15. 批量操作吞掉全部错误 + 无进度，失败也弹「已移动 N 个」

- 位置：`client/src/App.jsx:251-269`、`App.jsx:271-280`
- 问题：【事实】`Promise.all(ids.map(... .catch(() => null)))` 把每个请求的错误静默吞掉（违反「错误不吞」原则），随后无条件 `showToast('已移动 N 个技能到 X')`。10 个技能全失败，用户看到的仍是成功提示。并发期间也没有任何 loading 反馈，只有全部完成后列表才突变。
- 建议：收集结果，`const failed = results.filter(r => r.status === 'rejected')`（改用 `Promise.allSettled`），成功数/失败数分别提示；批量执行期间在批量操作条上显示「处理中 3/10」；失败项保留在多选集合里方便重试。
- 影响：中　工作量：小

### 16. ⌘K 命令面板只能搜「当前文件夹已加载的技能」

- 位置：`client/src/App.jsx:477`（`skills={skills}`）、`CommandPalette.jsx:57-68`
- 问题：【事实】面板的技能候选来自当前列表 `skills`，而 `skills` 是按 `currentFolder` 过滤后的结果（`App.jsx:101-106`）。在「收藏」视图下按 ⌘K 搜一个未收藏的技能，永远搜不到。这违背命令面板「全局跳转」的心智模型。此外面板每次打开都重置 query（`CommandPalette.jsx:46-55`），没有「最近执行」记忆。
- 建议：① 单独维护一份全量技能索引（首屏拉一次 `/api/skills?folder=all`，写操作后增量更新即可，本地单人数据量很小）喂给面板；② 选中跨文件夹技能时同步切 folder；③ 面板加「最近执行的 3 条命令」置顶（存 localStorage）。
- 影响：中　工作量：中

### 17. 核心导航状态一个都不持久化：刷新必回「收件箱」

- 位置：`client/src/App.jsx:40-43`（`currentFolder` / `currentTag` / `searchQuery` / `sortBy` 全是裸 `useState`）
- 问题：【事实】文件仅有的 `usePersistedState`（`App.jsx:22-37`）只用在 `sidebar-collapsed` 和 `recent-skills` 两处。桌面端本地工具刷新频率不低（改完后端重启、HMR 全量刷新），每次都回到默认视图重新找位置。
- 建议：`currentFolder` / `currentTag` / `sortBy` 直接换成 `usePersistedState`（一行改动）；`searchQuery` 建议进 URL 而非 localStorage（避免刷新后被旧搜索词困住却不自知）；恢复时对 `currentFolder` 做一次合法性校验（文件夹可能已被删）。
- 影响：中　工作量：小

### 18. 详情内的文件 tab、文件树展开、过滤词全部随切技能丢弃

- 位置：`client/src/components/SkillDetail.jsx:236`（`selectedFile` 固定初始化为 `'SKILL.md'`）、`SkillDetail.jsx:246`（`openDirs` 空 Set）、`SkillDetail.jsx:260`（`fileFilter`），叠加 `App.jsx:455` 的 `key` 强制重挂
- 问题：【事实】在技能 A 里展开 `scripts/` 并打开 `scripts/run.sh`，切到 B 再切回 A，回到 `SKILL.md`、目录全收起。多文件技能之间来回对照时反复手动展开。
- 建议：在 App 层（或 `SkillDetail` 外层）维护 `Map<skillId, {selectedFile, openDirs}>` 的会话缓存，`SkillDetail` 挂载时读初值；并把 `openDirs` 的默认策略改为「自动展开包含当前文件的目录」。
- 影响：中　工作量：中

### 19. 左栏文件夹展开状态不持久化，且初始值是硬编码的个人目录名

- 位置：`client/src/components/FolderTree.jsx:55`（`useState({ ADL4: true })`）
- 问题：【事实】默认展开的 `ADL4` 是某个具体用户的文件夹名，硬编码在组件里——对其他人（或改名后）是空配置。展开/收起状态也不持久化，刷新后全部收起，深层目录每次重新点开。
- 建议：去掉硬编码；改为 `usePersistedState('folder-expanded', {})`；并在 `currentFolder` 是深层路径时自动展开其所有祖先节点。
- 影响：中　工作量：小

### 20. Toast 反馈滞后于操作，且「撤销」同样走全量刷新

- 位置：`client/src/App.jsx:241-248`（`await runMutation(...)` 之后才 `showToast`）、`App.jsx:229-236`
- 问题：【事实】`handleTrashSkill` 先 `await` 完成「删除 + refreshAll（5 请求）」才弹 Toast，提示比视觉变化更晚；撤销回调又是一次完整的 `runMutation → refreshAll`。数量上 Toast 不算过多（`Toast.jsx:19` 限制同时最多 3 条，5s 自动消失，设计合理），问题在时机与代价。
- 建议：配合发现 3 的乐观更新，把 Toast 提到请求发出的同一帧；撤销也走乐观路径。另外 `Toast.jsx:19` 的 `[...prev.slice(-2), new]` 在批量操作时会把前一条挤掉，可考虑对同类操作做合并（「已移动 3 个技能」而不是 3 条）。
- 影响：中　工作量：小

### 21. 「最近浏览」的展示条目随当前文件夹缩水，计数会跳

- 位置：`client/src/App.jsx:333-336`（`recentSkillIds.map(id => skills.find(...))`）、`FolderTree.jsx:261-264`（用 `recentSkills.length` 当计数）、`App.jsx:88-99`（`recent` 视图要全量拉 `folder=all` 再内存过滤）
- 问题：【事实】`recentSkills` 从**当前文件夹的** `skills` 里查找，所以在「收藏」视图下侧栏「最近浏览」可能只剩 1 条，计数数字随文件夹切换乱跳。而点进 `recent` 视图又要额外拉一次全量列表（`App.jsx:90`）。
- 建议：把「最近浏览」的技能元信息（id/name/slug/folder_path）一起存进 localStorage，展示不依赖当前列表；`recent` 视图直接用这份缓存渲染，后台再静默校验存在性。
- 影响：中　工作量：小

### 22. 首屏 497KB 单 bundle、无分包、无 app shell，白屏到内容一次性跳变

- 位置：`client/vite.config.js`（无 `build.rollupOptions.manualChunks`）、`client/index.html:11`（`#root` 为空）、`SkillDetail.jsx:2-3`（`marked` + `highlight.js/lib/common` 顶层静态导入）、实测 `client/dist/assets/index-B4e0gNtU.js` = 496,912 B
- 问题：【事实】`SkillDetail` 被 App 直接静态引入，marked + hljs common（含几十种语言）进入首屏主 chunk。`index.html` 的 `#root` 是空的，JS 解析完成前是纯白页，之后再闪一次骨架屏。
- 建议：① `marked` / `highlight.js` 改成 `SkillDetail` 内部动态 `import()`（首屏只渲染骨架，markdown 就绪后替换）；② `manualChunks` 把 react / hljs 拆出来；③ 在 `index.html` 的 `#root` 里内联一个三栏静态骨架（几十行 HTML + CSS），消掉白屏阶段。
- 影响：中　工作量：中

### 23. 组合（Bundle）相关操作全部无乐观更新、无错误处理

- 位置：`client/src/components/Bundles.jsx:26-31`、`Bundles.jsx:33-38`、`Bundles.jsx:49-57`、`Bundles.jsx:123-133`、`App.jsx:505-512`
- 问题：【事实】`removeSkill` / `addSkill` 每次都 `await fetch` 后 `load()` 重拉组合详情 + `onChanged()` 刷左栏 4 接口；所有 `fetch` 都不检查 `res.ok`（`Bundles.jsx:27,34,50,155`），服务端 500 时 UI 照样弹「已移除」。`openAdd`（`Bundles.jsx:40-47`）每次点开都全量拉 `/api/skills?folder=all` 且无 loading 态，列表突然出现。
- 建议：本地先增删 `detail.items` 再发请求，失败回滚 + Toast；`fetch` 统一走 `App.jsx:12-19` 那个 `requestJson`（目前它没被 Bundles/Modals 复用，是明显的重复实现）；`openAdd` 加 loading 骨架。
- 影响：中　工作量：中

### 24. 版本恢复后只回填正文，标题/描述/列表不同步

- 位置：`client/src/components/SkillDetail.jsx:596-599`（`onRestored` 里只 `setContent(fresh.content)`）
- 问题：【事实】恢复一个旧版本后，`name` / `description` / `fileTree` 不更新，左侧列表行的名称和更新时间也不刷新（没有通知 App 层）。界面处于「正文是旧版、标题是新版」的不一致状态，直到用户手动切换技能。
- 建议：`onRestored` 里把 `fresh` 的 `name/description/file_tree` 一并回填，并回调 App 层做一次 `fetchSkills`（或局部 patch 该行）。
- 影响：中　工作量：小

### 25. 文件夹操作仍用 `window.prompt` / `confirm` 阻塞主线程

- 位置：`client/src/components/FolderTree.jsx:138-156`、`App.jsx:283`（永久删除的 `window.confirm`）
- 问题：【事实】新建/重命名文件夹用 `window.prompt`，删除用 `window.confirm`，这类原生弹窗会冻结渲染、样式与深色主题割裂，且无法校验输入（空格、非法字符、重名都得等服务端报错）。项目已经有成熟的 `DialogShell`（`Modals.jsx:21-66`）和 Toast + 撤销机制。
- 建议：文件夹新建/重命名改用 `DialogShell` 小弹窗（带即时校验）；删除改为「先执行 + Toast 撤销」（服务端 `routes/folders.js:121` 的删除语义是把技能移回收件箱，本身可逆，很适合撤销模式）。
- 影响：中　工作量：中

### 26. 详情区错误横幅在「没有选中技能」时不显示

- 位置：`client/src/App.jsx:447`（`{appError && selectedSkill && (...)}`）
- 问题：【事实】`appError` 只在**有选中技能**时才在详情区显示。列表为空 + 请求失败时走 `SkillList` 的错误态（`SkillList.jsx:131-136`）尚可，但若 `selectedSkill` 为 null 而列表非空（例如选中项被筛掉），错误信息静默丢失。
- 建议：把错误条件从 `appError && selectedSkill` 改为 `appError`，空态下也渲染重试入口。
- 影响：低　工作量：小

### 27. `/api/skills` 返回每条技能的完整 `content`，列表随内容线性膨胀

- 位置：`server/routes/skills.js:57`（SELECT 含 `content`）、`server/routes/skills.js:73-77`（`content LIKE` 搜索）
- 问题：【事实】实测当前 7 条技能共 5.5KB（content 1721 字符），无压力；但这是「列表接口返回全文」的结构性设计。若技能增至上百条、单个 SKILL.md 数十 KB，每次文件夹切换/每次搜索按键都要传输全部正文。**好的一面**：正因为列表带 content，切换技能时详情能立即渲染而不白屏（`SkillDetail.jsx:240` 的 `loadingDetail = !skill.content` 因此为 false）——改动时务必保留这个收益。
- 建议：改为列表返回 `content_preview`（前 200 字）+ `content_size`，详情走单条接口；同时前端加一层 `Map<skillId, detail>` 内存缓存，二次点击零请求零闪烁。当前规模下可不动，等技能数破百再改。
- 影响：低（当前规模）　工作量：中

### 28. dev server 无 API 代理，按「vite 单独起」的方式跑不通

- 位置：`client/vite.config.js`（仅 `plugins: [react()]`，无 `server.proxy`）
- 问题：【事实】前端所有请求都是 `/api/...` 相对路径（`App.jsx:70-73` 等），Vite dev server（5173/5196）没有代理到 Express（默认 9444），请求会落到 Vite 自身并返回 index.html，`response.json()` 解析失败后被 `App.jsx:14` 的 `.catch(() => ({}))` 吞成空对象，界面表现为「一直空列表」而非明确报错。实际可用路径是 `npm run build` 后由 Express 托管 `client/dist`（`server/index.js:354-364`）。
- 建议：`vite.config.js` 加 `server: { proxy: { '/api': 'http://localhost:9444', '/s': 'http://localhost:9444' } }`；同时 `requestJson` 在 `content-type` 不是 JSON 时抛明确错误，别静默吞。
- 影响：低（开发体验，但影响所有后续验证）　工作量：小

---

## 建议的实施顺序

**第 0 批（前置，10 分钟）**：发现 28（vite proxy）——不修这条，后面每一条都没法在浏览器里实测验证。

**第 1 批：一改就有体感，且互相独立（半天）**
1. 发现 5（编辑模式短路 markdown 渲染）—— 单行 `useMemo` 条件，消除输入卡顿
2. 发现 1（搜索防抖 + 刷新时保留旧列表，不换骨架）
3. 发现 7（面包屑改为导航，去掉误触发的 move）
4. 发现 9（最近浏览只记用户点选）
5. 发现 19（去掉 `ADL4` 硬编码 + 展开状态持久化）
6. 发现 17（folder/tag/sort 换成 `usePersistedState`）

**第 2 批：结构性修正（一天）**
7. 发现 6（请求取消/竞态）—— 先于任何乐观更新改造，否则回滚逻辑会踩竞态
8. 发现 2 + 3（`runMutation` 引入局部失效 + 乐观更新工具，先覆盖移动/废纸篓/保存）
9. 发现 4（选中项保留策略）—— 依赖第 8 条的本地 patch 能力
10. 发现 11（列表滚动位置）—— 前两条修完后基本自然成立，补 sessionStorage 收尾
11. 发现 15（批量操作不吞错 + 进度）
12. 发现 20（Toast 提前到操作同帧）

**第 3 批：持久化与可恢复（一天）**
13. 发现 8（URL 承载 folder/tag/q/skill + popstate）
14. 发现 10（编辑草稿 localStorage + 恢复提示 + beforeunload）
15. 发现 13 + 14（弹窗草稿：成功清空 / 误关保留 + 提示）
16. 发现 18（详情 tab 与文件树展开的会话缓存）
17. 发现 21（最近浏览存元信息，不依赖当前列表）

**第 4 批：打磨（按需）**
18. 发现 12（预留文件栏宽度，消抖动）
19. 发现 16（命令面板全局索引 + 最近命令）
20. 发现 22（动态 import markdown 栈 + app shell 骨架）
21. 发现 23 + 24（Bundle 乐观更新与统一 `requestJson`；版本恢复字段同步）
22. 发现 25（文件夹操作去掉原生 prompt/confirm）
23. 发现 26、27（错误态兜底；列表接口瘦身——等技能数破百再做）
