# 错误可恢复性 审查

审查范围：`client/src/App.jsx`、`client/src/components/*.jsx`、`server/index.js`、`server/routes/*.js`、`server/db.js`。只读审查，未修改任何文件，未做 git 操作。方法为逐文件通读 + 代码路径推演（未实际起 vite/kill 后端做浏览器复现，结论标【推测：基于代码路径分析】的以此为准，其余为【事实（附证据）】）。

## 现状摘要

| 错误场景 | 当前表现 | 期望表现 |
|---|---|---|
| 组件渲染时抛异常（如 marked 解析崩溃、DOM 操作异常） | 【事实】无任何 ErrorBoundary，React 会整页卸载→白屏，用户只能刷新 | 顶层 ErrorBoundary 兜底，显示"这部分出错了，点击刷新"，不影响其他区域 |
| localStorage 不可用（隐私模式/存储禁用/损坏 JSON） | 【事实】`App.jsx` 的 `usePersistedState` 有 try/catch 会静默降级；但 `SkillDetail.jsx:249,253,279,283` 的 4 处 localStorage 读写**完全没有 try/catch**，异常会在渲染阶段抛出，叠加"无 ErrorBoundary"→整页白屏 | 所有 localStorage 访问统一 try/catch |
| 创建技能时 slug 与已有技能重复 | 【事实】`server/routes/skills.js:180-194` 静默覆盖已存在技能的全部内容，**且不做版本快照**，前端也不提示"这会覆盖同名技能" | 前端提前查重/提示；后端至少快照旧版本再覆盖 |
| 重命名文件夹到已存在的路径 | 【事实】`folders.path` 有 `UNIQUE` 约束（`server/db.js:20`），冲突时抛原始 SQLite 错误（如 `UNIQUE constraint failed: folders.path`），直接透传给用户 toast | 后端识别冲突返回友好 message（如"目标路径已存在"），前端照原样展示 |
| 后端整个进程未启动 | 【事实】生产模式下前后端同进程（`server/index.js:354-369`），后端不起=整站不可达，浏览器显示原生连接失败页，应用层无法介入；本地 dev（`vite --port 5195`）下无 `server.proxy` 配置，`/api/*` 请求会被 vite 自身处理返回 404，不会得到"连接失败"提示 | dev 模式建议加 `server.proxy` 让本地联调更贴近生产；生产模式下这属于预期外表现，只需保证 pm2/launchd 等有自动重启 |
| 单个 fetch 请求失败（网络中断，非 HTTP 错误） | 【推测：基于代码路径分析】`requestJson`（`App.jsx:12-19`）在 `fetch()` 本身 reject 时（TypeError: Failed to fetch）不会走 `!response.ok` 分支，而是直接把浏览器原始英文错误消息抛出，最终展示给用户的是英文技术性文案而非"无法连接服务器" | 对 `fetch` 的 reject 单独 catch，转成统一中文提示 |
| 批量移动/批量删除中部分请求失败 | 【事实】`App.jsx:254,258,273,277` 用 `.catch(() => null)` 吞掉单条请求失败，成功提示仍按总数展示（"已移动 N 个技能"），用户不知道实际只成功了几个 | 统计真实成功数，失败的单独提示，可选重试 |
| 表单编辑中途切换到另一个技能 | 【事实】`App.jsx:454` 对 `SkillDetail` 用 `key={selectedSkill.id}`，切换选中技能会整体卸载重建 `SkillDetail`，编辑中未保存的 `content`/`name`/`description` 直接丢失，无任何确认弹窗 | 有未保存改动时切换需二次确认，或自动暂存草稿 |

## 发现（按影响排序）

### 1. 全局无 Error Boundary，任意组件渲染异常导致整页白屏
- 位置：`client/src/main.jsx:1-10`（全局搜索 `ErrorBoundary`/`componentDidCatch`/`getDerivedStateFromError` 均无命中）
- 问题：React 19 应用没有任何错误边界。`SkillDetail.jsx` 里 `marked.parse`、`highlight.js`、DOM 手动操作（`useEffect` 里对 `container.querySelectorAll` 结果直接操作，`renderTreeNode` 递归等）任何一处抛出未捕获异常，整个 `<App>` 树会被 React 卸载，页面变白屏，用户唯一的恢复手段是刷新（刷新后如果诱因还在，会反复白屏）。
- 建议：在 `main.jsx` 包一层 `<ErrorBoundary>`（class 组件即可），至少覆盖 `<App>` 顶层；再在 `SkillDetail`（内容最复杂、风险最高的组件）单独包一层局部边界，崩溃时只影响详情区，列表和侧栏仍可用。
- 影响：高　工作量：小

### 2. 创建技能 slug 撞车会静默覆盖别的技能内容，且不做版本快照
- 位置：`server/routes/skills.js:180-194`（POST `/api/skills`）
- 问题：`NewSkillModal`/`PasteSkillModal` 生成的 slug 由名称自动 slugify（`Modals.jsx:94` `handleNameChange`），用户容易撞到已有 slug（如两次都叫"部署脚本"）。后端发现 `existing` 直接 `UPDATE` 覆盖，返回 `{message:'Skill updated', ...}`。前端 `handleCreateSkill`（`App.jsx:287-295`）只关心 `created?.id` 是否存在就当创建成功，完全不会告诉用户"这其实覆盖了一个已存在的技能"，而且这条覆盖路径没有调用 `snapshotSkillVersion`（对比 PUT `/:id` 的 `skills.js:268` 有快照），旧内容**无法通过历史版本恢复**，是真实的数据丢失。
- 建议：POST 创建接口若命中 `existing`，要么直接拒绝（400 提示"slug 已存在，请修改标识符或改用编辑"），要么至少覆盖前调用 `snapshotSkillVersion`；前端在提交前（或后端 400 时）用醒目提示告知用户。
- 影响：高　工作量：小

### 3. `SkillDetail.jsx` 中 4 处 localStorage 读写无 try/catch
- 位置：`client/src/components/SkillDetail.jsx:249`（`useState` 初始化 `window.localStorage.getItem('ash:file-sidebar-width')`）、`253`（`outlineHidden` 初始化）、`279`、`283`（两个 `useEffect` 里的 `setItem`）
- 问题：Safari 隐私模式、浏览器存储配额耗尽、`localStorage` 被用户禁用等场景下这四处会直接抛异常。前两处发生在组件渲染阶段（`useState` 初始化函数），没有任何保护；结合发现 1（无 ErrorBoundary），任何打开一个技能详情页都可能直接白屏。对照 `App.jsx:22-37` 的 `usePersistedState` 已经有 try/catch 的降级模式，这里明显遗漏。
- 建议：抽一个 `safeLocalStorage.get/set` 工具函数（读失败返回默认值，写失败静默降级），`SkillDetail.jsx` 这 4 处直接复用。
- 影响：高　工作量：小

### 4. 编辑中切换选中技能，未保存内容直接丢失、无确认
- 位置：`client/src/App.jsx:454-459`（`<SkillDetail key={selectedSkill.id} .../>`），`client/src/components/SkillDetail.jsx:527-543`（`switchMode`/`handleSave` 中的 dirty 判断只在同一实例内切 preview/edit 时生效，对"选中另一个技能"这个外部触发完全无感知）
- 问题：`key` 随 `selectedSkillId` 变化会强制卸载重建 `SkillDetail`，其内部 `content`/`name`/`description` 的本地 state（未保存的编辑内容）随之丢失。用户在编辑一篇较长的 SKILL.md，中途手滑点了列表里的另一个技能（或被 `CommandPalette` `⌘K` 跳转），编辑内容无声消失，且没有 `beforeunload` 或路由拦截。
- 建议：在 `App.jsx` 的 `handleSelectSkill`/`onSelectSkill` 入口检查"当前详情是否处于 edit 模式且有 dirty 改动"（可通过 ref 或回调从 `SkillDetail` 上报），有则 `window.confirm` 二次确认或自动触发保存；同时给浏览器标签页关闭/刷新加 `beforeunload` 监听（仅在 dirty 时启用）。
- 影响：高　工作量：中

### 5. App 级错误横幅只在 `selectedSkill` 存在时渲染，folders/stats/tags/bundles 拉取失败会被完全吞掉
- 位置：`client/src/App.jsx:67-82`（`fetchFoldersAndStats` catch 里只 `setAppError`）、`client/src/App.jsx:447-452`（`{appError && selectedSkill && (...)}`）
- 问题：`fetchFoldersAndStats` 失败（例如 `/api/folders`、`/api/skills/stats`、`/api/skills/tags` 任一超时/500）会把错误塞进 `appError`，但 UI 只有在 `selectedSkill` 非空时才显示这个横幅。若此时列表为空（新装环境、当前筛选没有技能，或 skills 拉取也失败导致 `selectedSkill` 为 null），错误横幅永远不会出现——侧栏文件夹树/统计数字保持旧值或空白，用户毫无线索。
- 建议：错误横幅的展示条件去掉 `&& selectedSkill`，只要 `appError` 非空就在某个稳定位置（如顶部通栏）展示，并带重试按钮。
- 影响：中　工作量：小

### 6. 批量操作中单条请求失败被 `.catch(() => null)` 静默吞掉，成功提示与实际不符
- 位置：`client/src/App.jsx:254,258`（`handleBatchMove`）、`273,277`（`handleBatchTrash`）、`262-266`（批量移动撤销）
- 问题：`Promise.all(ids.map(...).catch(() => null))` 把每条请求的失败都吞成 `null`，随后无条件 `showToast('已移动 N 个技能到 X')`。如果 5 个里有 2 个因为技能已被删除/网络抖动而失败，用户看到的是"已移动 5 个"，但实际只有 3 个成功，且没有任何渠道能发现哪 2 个失败了。
- 建议：`Promise.allSettled` 替代，统计 `fulfilled`/`rejected` 数量，toast 文案改为"已移动 3/5 个技能（2 个失败）"，失败的 id 列表可在 console.error 里保留方便复盘（单人工具场景，控制台就是唯一的"监控"）。
- 影响：中　工作量：小

### 7. `Bundles.jsx` 里多处写操作完全没有错误处理
- 位置：`client/src/components/Bundles.jsx:26-31`（`removeSkill`）、`33-38`（`deleteBundle`）、`49-57`（`addSkill`）、`124-133`（`NewBundleModal.submit` 部分有判断但 fetch 本身可能 reject）、`152-163`（`AddToBundleModal.add`，`finally` 里 `onDone`/`onClose` 无论成功失败都执行）
- 问题：`removeSkill`/`deleteBundle`/`addSkill` 直接 `await fetch(...)`，不检查 `r.ok`，不 catch。后端返回 404/500 时（比如组合已被删除、技能已被删除）前端会认为操作成功，照常 `showToast('已删除组合...')`、关闭弹窗、刷新，实际操作可能根本没生效，用户无从得知。`AddToBundleModal.add`（149-163）里 `finally { setBusy(false) } onClose()` 结构更严重：即使 `fetch` 抛错或返回非 2xx，`onClose()` 仍会执行，用户以为加入成功，实际失败，且没有 toast 报错。
- 建议：统一改成本文件其他地方已经在用的 `try { if(!r.ok) throw ... } catch(e){ setError/showToast }` 模式；`AddToBundleModal.add` 的 `onClose()`/`onDone()` 移到 try 成功分支内，失败时展示错误且不关闭弹窗，方便用户重试。
- 影响：中　工作量：小

### 8. `VersionHistoryModal` 里"打标签"操作（Enter 触发）无任何错误反馈
- 位置：`client/src/components/Modals.jsx:313-322`
- 问题：`onKeyDown` 回调里直接 `await fetch(...PUT.../label...)`，不检查响应状态，不 catch。如果失败（网络问题、版本已被删除等），用户按了 Enter，输入框看起来"什么都没发生"，也不知道标签到底保存没保存；随后还会无条件重新拉取 `versions` 列表覆盖本地输入。
- 建议：包一层 try/catch，失败时用 `setError` 展示，并保留用户刚输入的文案，不覆盖。
- 影响：中　工作量：小

### 9. Toast 提示：无复制按钮、停留时间固定不随内容长度调整、最多同时 3 条会挤掉更早的错误
- 位置：`client/src/components/Toast.jsx:17-23`（`duration = 5000` 写死）、`19`（`prev.slice(-2)` 只保留最近 2 条再加新的 1 条，超过会被挤掉）
- 问题：（1）错误消息可能包含后端返回的具体 message（甚至像发现 4 里提到的原始 SQL 错误），5 秒后自动消失且没有"复制"按钮，用户想反馈问题或截图记录都来不及。（2）连续触发多个错误/提示（比如批量操作里既有成功 toast 又有失败 toast）时，队列最多 3 条，更早还没读到的错误提示会被挤掉且不会重新出现。
- 建议：错误类 toast（可以加个 `type: 'error'` 字段）停留时间更长或不自动消失（需手动关闭），加一个"复制"小按钮把 `message` 写入剪贴板；队列上限可以提高或改成可滚动列表。
- 影响：中　工作量：小

### 10. `requestJson`/`getJson` 对网络层失败（fetch reject）与 HTTP 错误状态一视同仁，用户看到的是浏览器原始英文报错
- 位置：`client/src/App.jsx:12-19`（`requestJson`）、`client/src/components/SkillDetail.jsx:172-176`（`getJson`，逻辑重复的第二份实现）
- 问题：`fetch(url, options)` 本身在断网/DNS 失败/CORS 时会 reject（`TypeError: Failed to fetch` 或 Safari 下 `Load failed`），不会进入 `if (!response.ok)` 分支，而是直接把这条英文异常抛给上层，最终展示给用户的错误文案是英文技术术语，不是"无法连接到服务器，请确认服务已启动"这类友好提示，与代码里其余分支统一用中文的风格不一致。
- 建议：在 `requestJson`/`getJson` 外包一层，识别 `TypeError`（fetch 网络层失败）单独转换成"网络连接失败，请检查后端服务是否启动"；同时这两份几乎相同的实现建议合并成一个共享工具，减少以后各改各的风险。
- 影响：中　工作量：小

### 11. 文件夹创建/重命名走 `window.prompt`，前端零校验（空名后半段有挡，但重名、非法字符、超长名称都不挡）
- 位置：`client/src/components/FolderTree.jsx:137-148`（`createFolder`/`renameFolder`）
- 问题：只做了 `!name?.trim()` 判空和"新名字等于旧名字则跳过"两项前端校验。重名路径（同级已存在同名文件夹）、路径里包含 `/`（用户在"文件夹名称"里手滑打了 `a/b`，会被当成多级路径创建，行为出乎意料）等都没有前端提示，直接丢给后端。后端对创建走 `INSERT OR IGNORE`（`folders.js:60-64`）——重复路径会静默什么都不做但依然回 201"Folder created"，前端跟着弹"创建成功"，实际上文件夹没有任何变化（比如改名没生效），用户会以为操作生效了。
- 建议：前端创建/重命名前，用已有的 `folders` state 做一次本地重名检查，重复时直接提示，不发请求；后端 `INSERT OR IGNORE` 改成先查重返回 409/400 区分"已存在"和"新建成功"。
- 影响：中　工作量：小

### 12. 拖拽移动技能到文件夹（`handleDropOnFolder` 多选分支）没有走 `runMutation`，失败没有任何提示
- 位置：`client/src/App.jsx:341-356`
- 问题：单个技能拖拽（`rawId` 分支）复用了 `handleMoveSkill`，有乐观 toast + 撤销；但多选拖拽（`rawIds` 分支，`348-355`）直接对每个 id 调 `runMutation(...)`（不带 `refresh:false`，会各自触发一次 `refreshAll`，属于额外的小浪费）且**不等待**、不聚合结果，也没有像 `handleBatchMove` 那样给出"已移动 N 个"的统一反馈；如果某个技能移动失败，`runMutation` 内部虽然会 `showToast(error.message)`，但和单选拖拽的体验不一致（没有撤销选项），容易让人以为多选拖拽比单选"更弱"。
- 建议：多选拖拽复用 `handleBatchMove(folderPath, ids)` 逻辑，统一走批量成功/失败统计 + 撤销的路径。
- 影响：低　工作量：小

### 13. 大量 `catch (e) {}` 空 catch，异常被彻底吞掉且连 console 都没有
- 位置：`server/routes/skills.js:44`（tags 接口内层 JSON.parse 失败 `catch (e) {}`）、`client/src/App.jsx:34`（localStorage 写失败注释说"静默降级"但没有 `console.warn`）
- 问题：这些属于项目 CLAUDE.md 里明确的红线"错误不吞：catch 后必须日志+抛出/转业务错误"。虽然这几处单条失败确实影响不大（脏标签数据、存储写失败），但单人工具没有监控平台，唯一能回溯问题的就是浏览器/服务端控制台日志；空 catch 会让将来诊断"为什么某个标签消失了/为什么设置没保存"变得无据可查。
- 建议：至少加一行 `console.warn`/`console.error` 说明发生了什么、哪个数据被跳过，不需要抛出（不影响主流程），但要留痕。
- 影响：低　工作量：小

### 14. `usePersistedState` 恢复的 JSON 值不做结构校验
- 位置：`client/src/App.jsx:22-30`
- 问题：`JSON.parse(saved)` 成功不代表值的类型/结构正确（例如 `recentSkillIds` 被期望是数组，但 localStorage 里如果被手动改成字符串或对象也能 parse 成功）。后续 `recentSkillIds.map(...)`（`App.jsx:334`）、`recentIdsRef.current.map(...)`（`App.jsx:93`）如果拿到非数组值会直接抛 `TypeError`，同样撞上"无 ErrorBoundary→白屏"。
- 建议：`usePersistedState` 增加一个可选的 `validate`/`fallback` 参数，或者在具体使用处（`recentSkillIds`）用 `Array.isArray(parsed) ? parsed : initial` 兜底。
- 影响：低　工作量：小

### 15. 长操作（下载归档、打包 tar.gz）没有进度/超时/取消提示
- 位置：`client/src/components/SkillDetail.jsx` 中下载按钮 `<a href={.../archive.tar.gz} download>`（约 `detail-actions` 区域）；`server/routes/agent.js:217-229`（流式 `createSkillTarGzArchive`）
- 问题：下载走原生 `<a download>`，技能文件很多/很大时打包耗时，用户点击后没有任何"正在打包"反馈，只能靠浏览器自己的下载进度条（点了新标签也看不到），且没有失败提示——如果打包过程中抛错（`agent.js:226-228` 只在 try 外层包了 catch，但流已经通过 `res.attachment` 开始发送后再报错，`res.status(500)` 可能已经晚了，浏览器端会表现为"下载了一个损坏的文件"而不是明确的错误）。
- 建议：对于附件较多（比如 >20 个文件或历史上出现过慢的场景）可以先做一次轻量的"准备中"提示（loading 态按钮文案），后端流式打包异常时至少记录日志方便排查"为什么用户说下载的文件打不开"。
- 影响：低　工作量：中

## 建议的实施顺序

1. **先堵数据丢失/白屏两类高危口子**：#1（ErrorBoundary）→ #3（SkillDetail 的 localStorage try/catch）→ #4（编辑内容切换丢失确认）→ #2（创建技能 slug 撞车覆盖 + 快照）。这四个是"一次性事故"级别，且工作量都不大，性价比最高。
2. **统一错误处理姿势**：#10（网络层错误文案）→ #7（Bundles.jsx 补 try/catch）→ #8（版本标签操作补反馈）→ #6（批量操作用 allSettled）。这批都是把已有的"好模式"（`requestJson` + toast）推广到少数几个遗漏点，改动模式一致，可以一次性扫一遍全仓库解决。
3. **可见性与体验打磨**：#5（错误横幅展示条件）→ #9（toast 可复制/停留时间）→ #11（文件夹重名前端校验）→ #12（多选拖拽走批量逻辑）。
4. **收尾**：#13（空 catch 补日志）、#14（localStorage 结构校验）、#15（长操作反馈），可以合并进日常小改动里顺手做掉，不必单开任务。
