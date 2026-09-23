# 可访问性 + 主题舒适度 审查

审查范围：`client/src/index.css`、`client/src/App.jsx`、`client/src/components/{FolderPicker,FolderTree,CommandPalette,Modals,Bundles,SkillList,SkillDetail,Toast}.jsx`。只读审查，未修改任何文件；因环境限制未起浏览器实测，全部结论基于代码通读 + 手算对比度，标【推测】的地方以代码行为依据但未逐条真机验证。

## 现状摘要（含对比度计算表）

- **主题**：只有一套写死的深色主题（`index.css:26` `color-scheme: dark`），全仓库唯一一处媒体查询是 `prefers-reduced-motion`（`index.css:568-570`），没有 `prefers-color-scheme` 分支，也没有手动切换开关（`App.jsx` 全文没有 theme/toggle 相关 state）。
- **焦点管理基础**：`DialogShell`（`Modals.jsx:21-66`）做得比较规范——打开自动聚焦、Tab 环内循环（focus trap）、Esc 关闭、卸载时把焦点还给 `previouslyFocused`。这是全项目里唯一一处完整实现该模式的地方，其余弹层（`FolderPicker` 弹窗、`CommandPalette`）都没有对齐这个标准。
- **键盘导航**：`FolderTree.jsx` 的目录树实现了完整的上下左右键导航（97-136 行），但同构的 `SkillList`（技能列表）和 `SkillDetail.jsx` 里的文件树（`FileTreeNode`）都没有对应实现，体验不一致。
- **对比度实测**（用 index.css 里 `:root` 实际十六进制值，按 WCAG 相对亮度公式手算，4.5:1 为阈值）：

| 前景 \ 背景 | bg #0d1117 | surface #11161d | surface-raised #161b22 | surface-hover #1d242d |
|---|---|---|---|---|
| text #e6edf3 | 16.02 ✅ | 15.37 ✅ | 14.64 ✅ | 13.24 ✅ |
| text-muted #8b949e | 6.15 ✅ | 5.90 ✅ | 5.62 ✅ | 5.09 ✅ |
| **text-subtle #6e7681** | **4.12 ❌** | **3.95 ❌** | **3.77 ❌** | **3.41 ❌** |
| accent #4493f8 | 6.11 ✅ | 5.86 ✅ | 5.58 ✅ | 5.05 ✅ |
| accent-strong #2f81f7 | 5.05 ✅ | 4.85 ✅ | 4.62 ✅ | 4.17 ❌(临界) |
| danger #f85149 | 5.65 ✅ | 5.42 ✅ | 5.16 ✅ | 4.67 ✅ |
| focus #58a6ff | 7.49 ✅ | 7.19 ✅ | 6.85 ✅ | 6.19 ✅ |

`--text-subtle` 在全部四种背景上都不达标（3.41–4.12:1），且恰好是项目里用得最多、字号最小（.6rem–.72rem）的"次要信息"色——用在更新时间、文件大小、面包屑、frontmatter 键、nav-count 等大量元数据文字上，字越小越该对比度越高而不是越低。

## 发现（按影响排序）

### 1. 只有深色主题，不跟随系统、无法手动切换
- 位置：`client/src/index.css:26`（`:root { color-scheme: dark; ... }`），全文件无 `@media (prefers-color-scheme: light)` 分支；`client/src/App.jsx` 全文无 theme state。
- 问题：长时间在明亮环境（白天、靠窗）用深色 UI 容易视觉疲劳/反光，没有退路；系统级"外观自动切换"完全不生效。
- 建议：把颜色变量表拆成 light/dark 两组，默认跟随 `prefers-color-scheme`，加一个 `usePersistedState('theme', 'system')` 式的手动切换（放命令面板或顶栏图标），复用现有 `usePersistedState`（`App.jsx:22-37`）模式即可。
- 影响：高　工作量：中

### 2. 技能列表无方向键导航，Tab 遍历成本极高
- 位置：`client/src/components/SkillList.jsx:144-206`（`role="listbox"` / `role="option"`，每个 `<li>` 都是 `tabIndex={0}`，行内还有星标 + 移动 + 加入组合 + 下载 + 删除共 4-5 个可聚焦子元素，164-198 行）。
- 问题：`role="listbox"/"option"` 语义暗示应支持 ↑↓ 选中，但没实现；对比 `FolderTree.jsx` 目录树有完整箭头键支持，体验割裂。要用 Tab 在几十条技能间移动，每条要按 5-6 次 Tab 才能到下一行。
- 建议：给 `<ul>` 加 roving tabindex（只有当前行 `tabIndex=0`，其余 `-1`），`<ul>` 本身监听 ↑↓ 移动选中、→ 进入行内操作、←/Esc 退回列表，参照 `FolderTree.jsx` 的 `onKeyDown` 实现（97-136 行）搬一份过来。
- 影响：高　工作量：中

### 3. 文字对比度：`--text-subtle` 在所有背景上都低于 4.5:1
- 位置：`client/src/index.css:38`（`--text-subtle: #6e7681`），使用点举例：`.skill-updated`（236 行）、`.skill-location`（235 行）、`.nav-count`（181 行）、`.frontmatter-table th`（467 行）、`.version-meta`（518 行）、`.file-tree-row small`（306 行）。
- 问题：见上方对比度表，3.41–4.12:1，且字号普遍只有 .6-.72rem（9.6-11.5px），小字低对比是最伤眼的组合。
- 建议：把 `--text-subtle` 提亮到接近 `#7d8590`（对 bg 约 4.6:1）或直接复用 `--text-muted`（已达标）用在真正需要更弱层级的地方，只保留极少数装饰性场景用最暗的灰。
- 影响：高　工作量：小

### 4. 浏览器缩放会破坏布局，等于没有"放大字号"这条路
- 位置：`client/src/index.css:48-55`（`html, body, #root { overflow: hidden }`）+ `client/src/index.css:106-111`（`.app-shell { width: 100vw; height: 100dvh; min-width: 56rem; }`）。
- 问题：App 没有任何内部字号调节功能，唯一能变大字的手段是浏览器 Cmd+/Ctrl+，但 `.app-shell` 写死 `min-width: 56rem`（896px）且 `body` 是 `overflow: hidden`——缩放到一定比例后三栏网格就会被裁切，且没有滚动条可以看到被裁的部分。长时间盯屏想临时放大字号时会直接卡住。
- 建议：至少把 `overflow: hidden` 换成 `overflow: auto`（保证极端情况下能滚动到裁切内容），中期可以加一个"正文/代码字号"的用户设置（persist 到 localStorage），从根源解决而不是依赖浏览器缩放。
- 影响：高　工作量：中

### 5. `FolderPicker` 弹窗关闭后焦点丢失，不归还触发按钮
- 位置：`client/src/components/FolderPicker.jsx:112`（`onKeyDown` 里 `Escape` 只 `setOpen(false)`）、`92-95` 行（点击外部 `onDown` 同样只 `setOpen(false)`）。
- 问题：对比 `Modals.jsx` 的 `DialogShell`（24-50 行）在 effect 清理里做了 `previouslyFocused?.focus()`，`FolderPicker` 完全没有这一步——关闭后焦点掉到 `document.body`，键盘用户找不到自己刚才在哪，得重新 Tab 定位。
- 建议：在 `open` 变 `false`（包括 Escape/外部点击/选中项）的路径上统一调用 `triggerRef.current?.focus()`，可以在关闭逻辑集中处（`pick` 函数 105-109 行、Escape 分支 112 行、outside-click 分支 92-95 行）都补上，或者用一个 `closeAndReturnFocus()` helper 统一收口。
- 影响：中　工作量：小

### 6. 命令面板（⌘K）关闭后同样不归还焦点
- 位置：`client/src/components/CommandPalette.jsx`（`onClose` 由 `App.jsx:476` 传入 `() => setShowPalette(false)`，全组件没有记录打开前的 `document.activeElement`）。
- 问题：Esc 关闭、选中项执行后（`execute` 函数 101-105 行调用 `onClose()`）都不会把焦点送回触发前所在的元素，和 `DialogShell` 的规范行为不一致。
- 建议：在 `App.jsx` 里用一个 ref 记录打开 `showPalette` 前的 `document.activeElement`，`onClose` 时 `.focus()` 回去；或者把这段逻辑做成公共 hook（`useReturnFocus`），`DialogShell`、`FolderPicker`、`CommandPalette` 三处复用。
- 影响：中　工作量：小

### 7. 详情页文件树（`FileTreeNode`）没有键盘导航，和侧边栏目录树体验不一致
- 位置：`client/src/components/SkillDetail.jsx:105-170`（`role="tree"` / `role="treeitem"`，105-170 行全程只有 `onClick`，无 `onKeyDown`）。
- 问题：同一产品里两棵语义相同的树（侧边栏目录 vs 技能文件树），一棵有完整箭头键（`FolderTree.jsx:97-136`），一棵没有，只能逐个 Tab。
- 建议：把 `FolderTree.jsx` 里 `onKeyDown` 那段树导航逻辑抽成公共 hook（如 `useTreeKeyboardNav(containerRef, itemSelector)`），两处树组件复用，顺便修复第 2 条列表的键盘导航也可以参考同一套模式（虽然 listbox 和 tree 的 ARIA 模式不同，但"↑↓移动焦点、→/←展开收起"的实现思路可以共享）。
- 影响：中　工作量：中

### 8. 代码块字号比正文还小，行高/tab 宽度不利于长时间读代码
- 位置：`client/src/index.css:342`（`.markdown-document pre, .file-viewer pre { font-size: .77rem; ... tab-size: 2; }`），对比正文 `.markdown-document { font-size: .9rem; }`（329 行）。
- 问题：这是个技能库工具，正文里大量是代码/脚本示例，代码块字号（12.3px）反而比正文（14.4px）小，且 `tab-size: 2` 和大多数人习惯的 4 空格缩进视觉不一致（技能里如果用真实 tab 字符会被压缩显示）。
- 建议：代码块字号至少与正文持平或略大（如 `.82-.85rem`），`tab-size` 改成 `4`（更符合常见工具默认值）。
- 影响：中　工作量：小

### 9. Toast 撤销通知固定 5 秒消失，不因鼠标悬停/聚焦暂停
- 位置：`client/src/components/Toast.jsx:14-24`（`window.setTimeout(..., duration)`，`duration = 5000`，没有 `onMouseEnter`/`onFocus` 暂停计时的逻辑）。
- 问题：像"移入废纸篓"“批量移动”这类带"撤销"按钮的操作提示（见 `App.jsx:244-247` `handleTrashSkill`、`260-267` `handleBatchMove`），如果用户当下正专注在详情页读内容，没第一时间瞥到右下角，5 秒后撤销入口就消失了。
- 建议：给 `.toast-item` 加 `onMouseEnter` 暂停计时、`onMouseLeave` 重新计时（或者干脆把带 `actionLabel` 的 toast 延长到 8-10 秒，因为它比纯提示类消息需要更多反应时间）。
- 影响：中　工作量：小

### 10. 新建技能组合弹窗（`NewBundleModal`）Enter 键不能提交
- 位置：`client/src/components/Bundles.jsx:119-145`——输入框不在 `<form>` 内，也没有 `onKeyDown` 处理 Enter；对比同样是"输入名称后创建"的 `NewSkillModal`（`Modals.jsx:127` `<form onSubmit={handleSubmit}>`）、`PasteSkillModal`（`Modals.jsx:197`）都是标准 form 提交。
- 问题：在输入框里敲完名字下意识按 Enter 没反应，必须移动鼠标点"创建"按钮，三个"新建"类弹窗里独此一个行为不一致。
- 建议：把 `<div className="bundle-new">` 换成 `<form onSubmit>`，`submit` 函数改成 event handler，和另外两个弹窗对齐。
- 影响：低　工作量：小

### 11. 滚动条只做了 WebKit 前缀，Firefox 下会露出系统默认（可能浅色）滚动条
- 位置：`client/src/index.css:73-76`（只有 `::-webkit-scrollbar*` 规则），没有 `scrollbar-width` / `scrollbar-color`（Firefox 标准属性）。
- 问题：在 Firefox 打开这个深色 UI，四个滚动区域（sidebar/list/detail/file-sidebar）会用系统默认滚动条样式，深色背景上大概率突兀刺眼。
- 建议：在 `:root` 或 `*` 补一条 `scrollbar-width: thin; scrollbar-color: #30363d transparent;`，两行代码覆盖 Firefox。
- 影响：低　工作量：小

### 12. `aria-current="page"` 语义用错在文件夹/收藏夹导航上
- 位置：`client/src/components/FolderTree.jsx:195`（`aria-current={isSelected ? 'page' : undefined}`，folder-select）、`245`、`259` 行（nav-item 同样用 `'page'`）。
- 问题：`aria-current="page"` 按规范用于"当前处于一组页面链接中的哪一页"，这里选中的是"文件夹/系统分类"这种筛选态而非页面导航，更贴切的值是 `aria-current="true"`。属于语义精确度问题，不影响自用体验，顺手可修。
- 建议：三处 `'page'` 改成 `'true'`。
- 影响：低　工作量：小

### 13. 代码复制按钮通过原生 DOM 注入，脱离 React 生命周期
- 位置：`client/src/components/SkillDetail.jsx:400-429`（`useEffect` 里手动 `document.createElement('button')` 并 `pre.appendChild(btn)`，用 `pre.querySelector('.code-copy')` 防重复注入）。
- 问题：这类"用真实 DOM 手动挂 event listener"的模式容易在依赖数组变化时产生僵尸监听器或状态不同步（目前用 `pre.querySelector` 判重勉强兜住，但如果以后要给复制按钮加更多状态如 loading，会比较别扭）。不是 bug，是可维护性隐患，顺带列出。
- 建议：如果后续要扩展这块交互，考虑改成 React 组件配合 `dangerouslySetInnerHTML` 渲染纯文本内容 + 在 `<pre>` 外层用绝对定位叠一个 React 按钮，而不是操作子树 DOM。
- 影响：低　工作量：中（属于技术债，非紧急）

## 建议的实施顺序

1. **先修对比度**（第 3 条）——改一个 CSS 变量值，零风险零依赖，立刻全局生效。
2. **焦点归还**（第 5、6 条）——抽一个 `useReturnFocus` hook，两处复用，工作量小、收益覆盖两个交互面。
3. **列表/树键盘导航**（第 2、7 条）——把 `FolderTree.jsx` 已有的箭头键逻辑抽成可复用 hook，同时解决这两条，一次投入两处收益。
4. **主题可切换**（第 1 条）——工作量最大，但对"长时间盯屏"这个核心诉求收益也最大，放在前面几个小修复验证完后再动，避免和其它 CSS 改动冲突。
5. **缩放不裁切**（第 4 条）——`overflow: hidden` 改 `overflow: auto` 是一行改动，可以和第 1 条一起做（改主题变量时顺手把这行也改了）。
6. 其余（8/9/10/11/12/13 条）都是独立小修，随手改，不影响排期。
