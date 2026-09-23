# 视觉质量与美学 审查

> 审查方式：通读 `client/src/index.css`、`App.jsx`、`components/*.jsx`（App.css 为空文件）；用 `vite build` 产出 dist 后经后端 9444 端口在 Chrome 1440×900 实机截图（主界面 / 详情 / 编辑态 / 命令面板 / 新建弹窗 / 终端接入弹窗 / 废纸篓空状态 / 批量选择条 / 文件夹选择浮层 / Toast）。Vite dev 无 API 代理，故未走 5199。截图后已停进程、恢复原 dist、未改任何源文件。行号以当前工作树 `index.css`（570 行）为准。

## 现状摘要

整体是一套 GitHub Dark 派生的三栏布局：token 定义在 `:root`（bg / surface / border / text 三档 / accent / danger），字号全部走 rem 小数，密度偏紧、信息层级基本清晰，Toast / 命令面板 / 浮层的实现质量在同类工具里算不错。问题集中在三处：一是 token 体系"有名无实"——`index.css` 里散落着 30+ 个硬编码十六进制色和 20+ 档字号、10+ 档圆角，同一语义（hover 底色、浮层底色、危险色、等宽字体栈）反复用不同字面值；二是 Tailwind preflight 把 Markdown 正文的列表符号吃掉了，是当前最显眼的视觉 bug；三是缺乏辨识度——纯灰蓝 + GitHub 蓝的组合、品牌只有一个反白 Terminal 图标，emoji 与 lucide 混用，看起来像"任何一个 AI 生成的深色仪表盘"。下面 24 条按影响排序。

## 发现（按影响排序）

### 1. Markdown 正文列表符号被 Tailwind preflight 清空（实测 bug）
- 位置：`client/src/index.css:1-3`（`@tailwind base`）与 `:335-337`（`.markdown-document ul/ol` 只设 margin / padding，未恢复 `list-style`）
- 问题：实机 `getComputedStyle(.markdown-document ul).listStyleType === "none"`。技能正文里 `- 双 ThorX 架构下…` 这类无序列表渲染成缩进但无圆点的裸段落（见 STPC Planning / Inceptio 两个技能详情截图），有序列表同样丢编号。用户会以为 Markdown 没解析。
- 建议：`.markdown-document ul { list-style: disc; } .markdown-document ol { list-style: decimal; } .markdown-document ul ul { list-style: circle; }`，并给 `li::marker { color: var(--text-subtle); }` 让圆点比正文淡一档。任务列表（`<input type=checkbox>`）已在 marked 中生成，可加 `.markdown-document li:has(> input[type=checkbox]) { list-style: none; margin-left: -1.45rem; }`。
- 影响：高  工作量：小

### 2. 同一语义多套硬编码色值，token 只覆盖一半
- 位置：`client/src/index.css:116`（sidebar 背景 `#0b0f14`）、`:211`（搜索框 `#0b0f14`）、`:279`（mode-switch `#0b0f14`）、`:370`（输入框 `#0b0f14`）、`:437`、`:472`——同一"下沉输入底色"出现 6 次却没有 token；`:197`/`:428`/`:533` 浮层底 `#1b2129`、`:199` 菜单 hover `#252c35`、`:222` 行 hover `#171d24`、`:223` 选中 `#1a212a`、`:342`/`:350`/`:402`/`:501` 代码底 `#090d12`、`:161`/`:200`/`:438` 危险色 `#ff7b72`（而 `--danger` 是 `#f85149`，`:525` 又用 `#f87171`）、`:228`/`:523` 收藏金 `#d29922`、`:396`/`:460` 成功绿 `#56d364`、`:169`/`:203`/`:319`/`:459` hover 边框 `#3a424c` / `#3d444d` / `#484f58` 三种。
- 问题：改主题或调对比时要全文搜替；hover 底色在列表（`#171d24`）、导航（`--surface-raised`）、图标按钮（`--surface-hover`）三处不同，肉眼能看出"同样是 hover 却深浅不一"。
- 建议：在 `:root` 补齐并全文替换：`--surface-sunken: #0b0f14`（输入 / 开关槽 / sidebar）、`--surface-overlay: #1b2129`（菜单 / 浮层 / toast）、`--surface-code: #090d12`、`--row-hover: #171d24`、`--row-selected: #1a212a`、`--border-strong: #3d444d`、`--danger-text: #ff7b72`、`--warning: #d29922`、`--success: #56d364`、`--mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`（`:269`/`:294`/`:327`/`:340`/`:342`/`:372` 六处重复字体栈）。
- 影响：高  工作量：中

### 3. 缺乏辨识度：品牌只有一个反白 Terminal 图标，主色是 GitHub 默认蓝
- 位置：`client/src/index.css:39-40`（`--accent: #4493f8` / `#2f81f7`，与 GitHub Primer 完全一致）、`:165`（`.brand-mark` 纯白底黑图标）、`App.jsx:376-379`（品牌区）、`index.html:1117`（favicon）
- 问题：配色 / 字号 / 布局都是 GitHub Dark 的复刻，没有一处让人记住"这是技能库"。品牌块是白方块 + 黑 `>_`，与右上 `复制 Agent 指令` 的蓝按钮互不呼应。
- 建议（择一即可）：把 accent 换成非 GitHub 蓝的单一强调色并贯穿——例如 `--accent: #e8a33d`（琥珀，与已有收藏金 `#d29922` 同族，"技能 = 收藏的能力"隐喻）或 `--accent: #7c9cff`（周期蓝紫）；`.brand-mark` 改用 `background: var(--accent); color: #0d1117`，让品牌块、主按钮、选中态、大纲高亮条共用一个色；`.skill-summary` 左边线（`:324` 的 `#3d444d`）与 `.doc-outline li.is-active` 左边线（`:463`）统一改成 accent。给 `#skill-detail` 顶部 toolbar 加一道 1px 渐变 `border-image: linear-gradient(90deg, var(--accent), transparent) 1` 作为唯一"签名"元素。
- 影响：高  工作量：中

### 4. 字号档位泛滥：0.6–0.95rem 之间 20 个不同值
- 位置：`client/src/index.css` 全文；样本：`.6rem`（:257/:297/:306/:420）、`.62rem`（:343/:457）、`.64rem`（:327/:523）、`.65rem`（:234/:269/:292/:412/:423）、`.66rem`（:315/:491/:519）、`.67rem`（:120/:175/:181/:185/:216）、`.68rem`（:204/:217/:280/:294/:419/:480/:505）、`.7rem`、`.71rem`（:202/:233）、`.72rem`、`.73rem`（:186/:302）、`.74rem`、`.75rem`、`.76rem`（:211）、`.77rem`（:342）、`.78rem`、`.79rem`（:177）、`.8rem`、`.82rem`、`.86rem`（:226）、`.9rem`、`.92rem`（:380）、`.95rem`（:271）
- 问题：`.67 / .68 / .7 / .71 / .72 / .73` 在视觉上无法区分，却让同一行里的元素（如卡片 footer `.65rem` 与 hover 图标 14px）对不齐；`html` 16px × 0.6rem = 9.6px，多处正文级文字低于 11px（`.rail-label`、`.palette-badge`、`.attachment-list small`），在 Retina 以外显示器发虚。
- 建议：收敛成 6 档 token：`--fs-2xs: .6875rem`(11px) / `--fs-xs: .75rem`(12px) / `--fs-sm: .8125rem`(13px) / `--fs-md: .875rem`(14px) / `--fs-lg: 1rem` / `--fs-xl: 1.25rem`；≤.68rem 全部并入 2xs，.7–.76 并入 xs，.77–.82 并入 sm，.86–.95 并入 md。正文 `.markdown-document` 保留 `.9rem`→改 `--fs-md` 或 `.9375rem`(15px)。
- 影响：高  工作量：中

### 5. 圆角 12 档、阴影 6 套，没有层级规律
- 位置：圆角 `.22rem`(:440) `.25rem`(:246/:424) `.28rem`(:198/:280/:341/:412) `.3rem`(:316/:322/:457/:519/:523) `.32rem`(:217) `.34rem`(:302) `.35rem`(:190/:350/:437/:472/:537) `.36rem`(:294) `.38rem`(:153/:177) `.4rem` `.42rem`(:165/:211/:279/:283/:318/:395) `.45rem`(:197/:245/:348) `.46rem`(:220/:501/:503/:516) `.48rem`(:342) `.5rem`(:289/:313/:351/:362/:428/:533) `.65rem`(:377/:408)；阴影 `:197` `0 12px 30px .35`、`:313` `0 10px 32px .35`、`:318` `0 6px 18px .3`、`:377` `0 22px 60px .55`、`:408` `0 24px 64px .55`、`:428` `0 12px 32px .5`、`:533` `0 14px 38px .5`
- 问题：`.45 / .46 / .48 / .5` 这种差 0.3px 的值只会造成"对不齐"的潜意识不适；浮层（folder-menu / doc-outline / picker / toast）四种阴影强度。
- 建议：`--r-xs: 4px`（inline code / kbd / badge）、`--r-sm: 6px`（按钮 / 输入 / 行）、`--r-md: 8px`（卡片 / 浮层 / 代码块）、`--r-lg: 10px`（对话框 / 命令面板）；阴影 `--shadow-pop: 0 8px 24px rgba(0,0,0,.4)`（菜单 / picker / toast / 大纲）、`--shadow-modal: 0 24px 64px rgba(0,0,0,.55)`（dialog / palette）两档即可。
- 影响：中  工作量：中

### 6. 图标风格混用：lucide + emoji + 文字符号
- 位置：`components/FolderPicker.jsx:181`（`📥 ` / `📁 ` emoji 前缀）、`Modals.jsx:305`（`🏷 {v.label}`）、`CommandPalette.jsx:134`（`⌘` 文本图标）、`Toast.jsx:50`（`×` 文字关闭）、`SkillList.jsx:162`（`✓` 文字勾）、`Modals.jsx:137`（标签移除 `×`）、`SkillDetail.jsx:566`（面包屑 `/` 用 `<i>`）
- 问题：emoji 在 macOS 上是彩色苹果风、在 Windows 是 Segoe 彩色，与 lucide 的 1.5px 线性图标风格冲突（实机截图里 picker 列表 📁 明显"跳"出来）；文字 `×` / `✓` 的粗细与 lucide 不一致，基线也不齐。
- 建议：picker 用 `<Folder size={13}/>` / `<Inbox size={13}/>`；版本标签用 `<Tag size={12}/>`；palette 图标用 `<Command size={15}/>` 或 `<Search size={15}/>`；Toast 关闭用 `<X size={14}/>`；row-check 用 `<Check size={11} strokeWidth={3}/>`；面包屑分隔用 `<ChevronRight size={11}/>` 并加 `opacity:.5`。统一 `strokeWidth` 默认 2（lucide 默认），只在 ≤12px 时用 2.5。
- 影响：中  工作量：小

### 7. 文件夹行右侧计数垂直错位（实测）
- 位置：`client/src/index.css:181-182`（`.nav-count` 及 `::after` inline-block 占位）、`:190`（`.folder-select` 高 1.85rem）
- 问题：实测 `.folder-select` 高 29.6px，内部 `.nav-count` 盒高 32.2px（`::after` 的 inline-block 撑出行盒），文字 `Planning …` 顶 472px 而 `1` 顶 465px，截图里 `1` 明显高于同行文字半个字。系统导航 `.nav-item`（高 2.1rem）没这个问题，只有文件夹树有。
- 建议：删掉 `.nav-count::after` 的 inline-block 占位，改 `padding-right: .35rem`；给 `.nav-count` 加 `line-height: 1; align-self: center`。
- 影响：中  工作量：小

### 8. 批量操作条在 233px 中栏里折成两行（实测）
- 位置：`client/src/index.css:435-439`（`.batch-bar` gap .6rem + `.danger-text-button` 带文字）、`SkillList.jsx:104-121`
- 问题：`已选 3 项` 折成两行，`移入废纸篓` 也折成两行，picker 触发器 `移动到…` 挤在中间，四个元素三种高度。
- 建议：`.batch-bar { flex-wrap: nowrap; white-space: nowrap; }`；`> span` 改 `flex: 0 0 auto`；`danger-text-button` 在中栏改为 icon-only（保留 `title` / `aria-label`），或把文字缩成 `废纸篓`；picker 触发器 `max-width: 6.5rem`。同时给条加 `background: var(--accent-muted)` + `border-bottom-color: rgba(68,147,248,.3)`，让"处于多选态"有明确的视觉信号（现在只是灰底）。
- 影响：中  工作量：小

### 9. 技能卡片 footer 与 hover 操作图标基线不齐
- 位置：`client/src/index.css:234`（footer `min-height: 1.15rem; font-size: .65rem`）、`:239`（`.row-actions .icon-button` 1.6rem）
- 问题：footer 文字 10.4px、行高 18px；hover 出现的四个 1.6rem（25.6px）图标按钮把 footer 撑高 7px，导致 hover 时整张卡片高度跳动（截图里 hover 卡片的 `inbox 9月23日` 略下沉）。`content-visibility: auto` 的 `contain-intrinsic-size` 也会因此偏差。
- 建议：footer 固定 `height: 1.6rem; align-items: center`，`.row-actions` 改 `position: absolute; right: .5rem; bottom: .3rem` 脱离流；hover 时用 `.skill-row:hover .skill-location, .skill-row:hover .skill-updated { opacity: .35 }` 让元信息让位而非挤位。
- 影响：中  工作量：小

### 10. hover / active / focus 三态不成体系
- 位置：`:158-159`（icon-button 有 hover + active 位移）、`:178`（nav-item 只有 hover）、`:191`（folder-select hover 只变色不变底）、`:218`（sort-button）、`:275`（primary hover 换色但无 active）、`:277`、`:295`、`:392`、`:511`、`:517`——共 14 处 hover 定义，`:active` 仅 icon-button 一处；`:focus-visible` 全局 2px 外描边（`:67`），但 `.skill-row:focus-visible` 改成 `-2px` 内描边（`:224`），`.search-field input:focus`（`:213`）与 `.file-filter input:focus`（`:473`）一个有 box-shadow 光晕一个没有。
- 问题：主按钮按下无反馈；文件夹行 hover 无底色而系统导航有，同一栏内两种行为；焦点环有的外扩有的内缩。
- 建议：定义三条通用规则：`.primary-button:active, .secondary-button:active { transform: translateY(1px); filter: brightness(.95) }`；所有可点行（`.nav-item`, `.folder-select`, `.file-tree-row`, `.palette li`, `.folder-picker-popover li`）统一 `:hover { background: var(--surface-hover) }`；焦点环统一 `outline: 2px solid var(--focus); outline-offset: -2px`（行内元素）/ `2px`（独立按钮），输入框统一 `border-color: var(--focus); box-shadow: 0 0 0 3px var(--accent-muted)`。
- 影响：中  工作量：中

### 11. 动效只有 Toast 一处入场，其余浮层"闪现"
- 位置：`:432`（唯一 keyframes `toast-in`）；`.dialog-backdrop`/`.dialog-panel`（`:376-377`）、`.palette-panel`（`:408`）、`.folder-menu`（`:197`）、`.folder-picker-popover`（`:533`）、`.doc-outline`（`:313`）均无 transition / animation；`.skill-row` transition 仅 background/border（`:220`）
- 问题：⌘K 面板、弹窗、菜单瞬间出现，缺少 Raycast / Linear 式的 120ms 缩放淡入；backdrop 也是瞬间变暗。
- 建议：加两个 keyframes 复用：`@keyframes pop-in { from { opacity:0; transform: scale(.98) translateY(-4px) } }`（菜单 / picker / 大纲，`.12s ease-out`）和 `@keyframes modal-in { from { opacity:0; transform: scale(.97) } }`（dialog / palette，`.16s cubic-bezier(.2,.8,.2,1)`）；backdrop `animation: fade-in .16s`。`prefers-reduced-motion` 已有全局兜底（`:568`）无需再处理。
- 影响：中  工作量：小

### 12. 空状态 / 加载态过于素：无图形、无层次
- 位置：`:141-143`（`.detail-empty` 纯文字）、`:240-243`（`.list-state`）、`:244-247`（骨架 3 条灰线）、`:362-364`（`.content-skeleton`）、`App.jsx:461-470`、`SkillList.jsx:126-142`
- 问题：废纸篓空状态和右栏"选择一个技能查看详情"都是两行灰字居中，与旁边内容密度不匹配，显得"没做完"；骨架屏只有 3 条等高线，与真实卡片结构（标题 / 两行描述 / footer）不对应，切换时会跳。
- 建议：空状态加一个 40px 的 lucide 图标（`Inbox` / `Trash2` / `FileText`）放在 `color: var(--text-subtle); opacity: .5` 的 `2.75rem` 圆形 `--surface-raised` 底上；骨架屏改成与 `.skill-row` 同结构（`i:nth-child(1)` 高 .8rem 宽 60%，`(2)(3)` 高 .55rem 宽 95%/70%，`(4)` 高 .5rem 宽 30%），外框 padding 与 `.skill-row` 一致；加 `@keyframes shimmer` 横向渐变代替纯 opacity 脉冲。
- 影响：中  工作量：小

### 13. 三栏背景层次太平：sidebar / list / detail 亮度差不足
- 位置：`:30-33`（`--bg #0d1117`、`--surface #11161d`、`--surface-raised #161b22`）、`:116`（sidebar `#0b0f14`）、`:124`（list `--surface`）、`:127`（detail `--bg`）
- 问题：三栏亮度 L 值分别约 5% / 7% / 6%，靠 1px 边线区分；选中卡片 `#1a212a` 与列表底 `#11161d` 对比 1.3:1，截图里选中态几乎只靠边框识别。
- 建议：按"越靠右越亮"或"内容区最暗、导航最亮"择一原则拉开：sidebar `#0a0d12` → list `#0f141a` → detail `#0d1117` 保持；选中卡片改 `background: var(--accent-muted); border-color: rgba(68,147,248,.35)` 与 `.is-checked` 呼应；或保留灰底但左侧加 `box-shadow: inset 2px 0 0 var(--accent)` 指示条。
- 影响：中  工作量：小

### 14. 顶部 toolbar 按钮尺寸 / 语义混排
- 位置：`SkillDetail.jsx:575-594`、`:273-281`（primary/secondary 2rem 高，mode-switch 内按钮 1.65rem，icon-button 1.9rem）
- 问题：同一行五个控件三种高度（32 / 30.4 / 26.4px），截图放大可见底边不齐；`复制 Agent 指令` 是唯一实心蓝按钮，但它并不是页面的"主任务"（主任务是阅读 / 编辑），视觉权重错配；下载 / 历史两个 `bordered-button` 与 `复制 CLI` 边框色相同但圆角不同（`.38rem` vs `.4rem`）。
- 建议：统一 toolbar 控件 `height: 2rem`；`mode-switch` 外框高 2rem、内按钮 `calc(2rem - .3rem)`；`复制 Agent 指令` 降为 secondary，把 `编辑` 态切换或保存作为 primary；图标按钮统一 `.bordered-button { border-radius: var(--r-sm) }`。
- 影响：中  工作量：小

### 15. 等宽字体大小与正文不协调
- 位置：`:269`（面包屑 mono `.65rem`）、`:327`（tag `.64rem`）、`:341`（inline code `.84em`）、`:342`（代码块 `.77rem`）、`:294`（attachment `.68rem`）、`:501`（bundle 命令 `.72rem`）、`:402`（setup pre `.7rem`）
- 问题：mono 天生比 sans 视觉偏大，这里却把它设得比周围 sans 更小（面包屑 10.4px），截图里 `inbox / voyager-worldsim` 几乎看不清；而代码块 12.3px 又比正文 14.4px 小太多，阅读节奏断裂。
- 建议：mono 统一两档：行内 / 元信息 `--fs-xs`(12px)，代码块 `.8125rem`(13px) 且 `line-height: 1.6`；面包屑改 sans `--fs-xs` + 仅 slug 段用 mono。
- 影响：中  工作量：小

### 16. Markdown 标题节奏：h1 与 h2 都带下划线，层级感被削弱
- 位置：`:332-334`
- 问题：h1（26.4px）和 h2（19.2px）都是 `border-bottom: 1px`，h3（16px）无线；截图中 `Voyager Worldsim 仿真调试指南` 与 `核心说明` 两条线相距 60px，视觉上像两个平级分区。正文 `line-height: 1.8`（`:329`）对 14.4px 中文偏松，段落间 `.72rem` 又偏紧，密度不均。
- 建议：h1 去下划线改 `margin-bottom: 1.5rem`，仅 h2 保留分割线且改为 `border-color: var(--border-muted); padding-bottom: .3rem`；h3 加 `color: var(--text-muted); font-size: .9375rem; text-transform: none; letter-spacing: 0`；正文 `line-height: 1.7`，段落 `margin: .9rem 0`。
- 影响：中  工作量：小

### 17. `.skill-summary` 与 `.frontmatter` 两个信息块风格互不一致
- 位置：`:324-328`（左边线 2px 灰 + 半透明底，无圆角）、`:348-350`（1px 边框 + 圆角 .45rem）
- 问题：两块上下紧邻（截图 y=76~180），一个方角引用样式、一个圆角卡片样式，且 `details > summary` 的原生 ▶ 三角与 lucide 风格冲突。
- 建议：合并成一个"元信息卡"：描述 + 标签 + 折叠属性表同框，`border: 1px solid var(--border-muted); border-radius: var(--r-md); background: var(--surface)`；summary 用 `list-style: none` + `::before` 画 `ChevronRight` SVG（data URI）并在 `[open]` 时旋转 90°。
- 影响：低  工作量：小

### 18. 标签（tag）样式三套
- 位置：`:204`（编辑态 pill 边框）、`:327-328`（详情摘要 `#tag` 纯文字 mono）、`:420`（palette badge pill .6rem）、`:523`（版本标签 黄底）
- 问题：同一"标签"概念在四处四种样式。
- 建议：抽 `.chip { display:inline-flex; align-items:center; height:1.25rem; padding:0 .45rem; border-radius:999px; border:1px solid var(--border-muted); background: var(--surface-raised); color: var(--text-muted); font-size: var(--fs-2xs) }`，变体 `.chip-accent` / `.chip-warning`。
- 影响：低  工作量：小

### 19. 弹窗内表单块与弹窗容器边距不一致
- 位置：`:379`（header `.95rem 1rem`）、`:382`（body `1rem`）、`:389`（footer 仅 `padding-top`，无左右 padding，依赖 body）、`Bundles.jsx:75`（`.bundle-detail` 直接放在 DialogShell 里，没有 `.dialog-body`，所以无 padding——截图实测 BundleDetail 内容贴边）、`Bundles.jsx:136`（`.bundle-new` 同样）、`Modals.jsx:293`（`.version-list` 同样）
- 问题：NewSkill / Paste / Setup 三个弹窗有 16px 内边距，Bundle 三个弹窗和版本历史贴边（`.bundle-detail`、`.bundle-new`、`.version-list` 没有包 `.dialog-body`）。
- 建议：DialogShell 内固定渲染 `<div className="dialog-body">{children}</div>`，各子组件去掉自带的 `dialog-body` class；footer 统一 `margin: 0 -1rem -1rem; padding: .85rem 1rem; background: var(--surface)` 形成底部浅色区。
- 影响：中  工作量：小

### 20. 命令面板缺少类型图标与分组，全靠右侧文字徽标区分
- 位置：`CommandPalette.jsx:152-166`、`:414-421`
- 问题：技能 / 目录 / 命令混排在一列，每行右侧一个 `技能` / `目录` / `命令` 文字胶囊，扫读成本高；截图里 12 行一样的灰字。Raycast / Linear 的做法是左侧 16px 类型图标 + 分组小标题。
- 建议：每项左侧加 `<FileText/>`（技能）`<Folder/>`（目录）`<Command/>`（命令）16px 图标，`color: var(--text-subtle)`，active 时变 accent；无搜索词时按类型分组，加 `.palette-group-label`（同 `.nav-divider` 样式）；去掉右侧徽标或仅对命令保留快捷键 kbd。
- 影响：中  工作量：中

### 21. `select` 原生控件与自绘 picker 并存
- 位置：`Modals.jsx:134`、`:201`（新建 / 粘贴弹窗用原生 `<select>`）；`:60-62`、`:202`、`:278`、`:437`（四处 select 样式）；而列表 / 侧栏用 `FolderPicker`
- 问题：原生 select 的箭头、下拉面板样式由系统决定，与自绘 picker 的搜索式浮层不一致；`.move-select` / `.batch-bar select` / `.tag-filter select` 三处样式现在已无 DOM 使用（dead CSS）。
- 建议：弹窗里也换成 `FolderPicker`（已支持 `options` 模式）；删除 `:202-203`、`:278`、`:437` 三段无用规则。
- 影响：低  工作量：小

### 22. 侧栏快捷操作三个按钮的层级倒置
- 位置：`:166-170`、`FolderTree.jsx:229-231`
- 问题：`新建` 是唯一带图标 + 亮底的，`粘贴导入` / `终端接入` 是描边；但 `终端接入` 独占整行（`grid-column: 1/-1`），视觉重量反而最大，而它是一次性设置项。
- 建议：`终端接入` 移到侧栏底部作为 `nav-item` 风格的设置入口（`<Settings size={16}/>`），顶部只留 `新建` + `粘贴导入` 两个等宽按钮；或三个都做成 icon+text 的等宽 tile。
- 影响：低  工作量：小

### 23. 大纲浮层与正文右边缘 / toolbar 关系生硬
- 位置：`:313`（`position: fixed; top: 5.4rem; right: 1.1rem`，`backdrop-filter: blur(4px)`）、`:264`（`--outline-channel` 定义了却没有任何规则消费）
- 问题：固定定位 + 毛玻璃在深色底上几乎看不出玻璃效果，只多了一层 GPU 合成；`--outline-channel` 是死变量。大纲距 toolbar 底 18px、距右边 17.6px，与正文列 `min(100% - 2.5rem, 40rem)` 的居中没有几何关系，大屏下正文和大纲之间出现 200px+ 的空洞。
- 建议：把大纲改为 `position: sticky; top: 1rem` 放在 `.detail-scroll` 内的 grid 第二列（`grid-template-columns: minmax(0,1fr) 13rem`），正文列 `max-width: 40rem; justify-self: center`；去掉 blur 与阴影，用 `border-left: 1px solid var(--border-muted)` 的无框列表（Notion / Docusaurus 风），删除 `--outline-channel`。
- 影响：中  工作量：中

### 24. 品牌区文案与 favicon / 标题重复，且副标题过小
- 位置：`App.jsx:378-379`（`h1 AnotherSkillHub` + `p Agent 技能库`）、`:119-120`（h1 `.9rem`、p `.68rem`）、`index.html:1121`
- 问题：副标题 10.9px 在 Retina 上勉强可读；折叠态只剩一个 `ChevronRight`，品牌完全消失。
- 建议：折叠态保留 `.brand-mark`（点击即展开），去掉副标题或改成 `Skills` 一词并用 `--fs-2xs; letter-spacing: .08em; text-transform: uppercase` 作为标签风格。
- 影响：低  工作量：小

## 建议的实施顺序

| 批次 | 内容 | 说明 |
|---|---|---|
| **P0 一起改（半天）** | #1 列表符号、#7 计数错位、#8 批量条折行、#9 footer 跳动 | 都是 ≤10 行 CSS 的实测 bug，可以进同一个 commit，先止血 |
| **P1 token 收敛（一天，同一 commit）** | #2 颜色 token、#4 字号档位、#5 圆角阴影、#15 mono 字号 | 一次性在 `:root` 补 token 后全文替换；这批必须一起做，否则替换两次 |
| **P2 一致性（半天）** | #6 图标统一、#10 三态、#18 chip、#19 弹窗边距、#21 删 dead select、#14 toolbar 高度 | 依赖 P1 的 `--r-*` / `--fs-*` token |
| **P3 辨识度与质感（一天）** | #3 强调色 / 品牌、#13 三栏层次、#11 动效、#12 空态骨架、#16 标题节奏、#17 元信息卡 | 主观性最强，建议先出一版截图对比再定 accent 色 |
| **P4 结构性（可选）** | #20 命令面板分组、#23 大纲 sticky 化、#22 侧栏操作重排、#24 品牌区 | 涉及 JSX 结构改动，单独 MR 或放最后 |

标注：以上 #1 / #7 / #8 / #9 / #19（Bundle 弹窗贴边）为【事实，已实机复现】；其余为基于代码 + 截图的【判断】。截图环境为 macOS Chrome 1440×900，Windows 字体渲染下 #4 / #15 的小字号问题会更明显（【推测】）。
