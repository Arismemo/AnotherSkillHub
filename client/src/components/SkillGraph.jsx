import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Focus, Minus, Network, Plus, RotateCw, Search, X } from 'lucide-react';
import { requestJson } from '../utils/requestJson';
import { GRAPH, demoGraph, layoutGraph } from '../utils/graphLayout';
import './SkillGraph.css';

const EMPTY = [];
const MIN_ZOOM = .5;
const MAX_ZOOM = 3;
const IDENTITY = { x: 0, y: 0, k: 1 };
const TICKS = Array.from({ length: 120 }, (_, index) => index * Math.PI * 2 / 120);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// 控制点向圆心收拢：同一元技能的连线自然汇成一束
function edgePath(from, to) {
  const cx = GRAPH.cx + ((from.x + to.x) / 2 - GRAPH.cx) * .78;
  const cy = GRAPH.cy + ((from.y + to.y) / 2 - GRAPH.cy) * .78;
  return `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
}

// 确定性伪随机（mulberry32）：星空每次渲染都在同一位置
function seeded(seed) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
// 星空铺得比画布大，平移时边缘不露底
const STARS = (() => {
  const rand = seeded(20260923);
  return Array.from({ length: 160 }, (_, index) => ({
    x: -300 + rand() * 1600, y: -300 + rand() * 1400, r: .35 + rand() ** 2.2 * 1.4,
    o: .12 + rand() * .5, twinkle: index % 3 === 0, delay: -rand() * 7,
  }));
})();
// 雷达扫描扇区：前缘在 0°，向后拖出 44° 的渐隐尾迹
const SWEEP_ANGLE = 44 * Math.PI / 180;
const SWEEP = {
  d: `M ${GRAPH.cx} ${GRAPH.cy} L ${GRAPH.cx + GRAPH.ring * Math.cos(-SWEEP_ANGLE)} ${GRAPH.cy + GRAPH.ring * Math.sin(-SWEEP_ANGLE)} A ${GRAPH.ring} ${GRAPH.ring} 0 0 1 ${GRAPH.cx + GRAPH.ring} ${GRAPH.cy} Z`,
  x1: GRAPH.cx + GRAPH.ring * .7 * Math.cos(-SWEEP_ANGLE), y1: GRAPH.cy + GRAPH.ring * .7 * Math.sin(-SWEEP_ANGLE),
  x2: GRAPH.cx + GRAPH.ring * .7, y2: GRAPH.cy,
};
const MAX_PARTICLES = 90; // 能量粒子上限：连线再多也不拖慢页面

const metaRadius = (usage) => 5.5 + Math.min(6.5, Math.sqrt(usage) * 1.5);

// 元技能名称沿径向朝外排：左半圆右对齐、右半圆左对齐、正上下居中。
// 垂直偏移用 em：字号随缩放反向补偿后，间距跟着字号走，不会被放大拉开
function metaLabel(node) {
  const cos = Math.cos(node.angle), sin = Math.sin(node.angle);
  const distance = metaRadius(node.usage) + 11;
  const anchor = cos > .3 ? 'start' : cos < -.3 ? 'end' : 'middle';
  const dy = anchor === 'middle' ? (sin > 0 ? '.95em' : '-.25em') : '.35em';
  return { x: cos * distance, y: sin * distance, dy, anchor };
}
const APP_LABEL = { x: 8, y: 0, dy: '.35em', anchor: 'start' };

// 估算标签在屏幕上的宽度：中日韩字符约一个字号宽，其余约 0.58 个
function textWidth(text, px) {
  let width = 0;
  for (const ch of text) width += /[\u2e80-\uffff]/.test(ch) ? px : px * .58;
  return width;
}

// 标签在屏幕坐标下的包围盒。节点按 √k 缩放，所以标签相对节点的偏移也按 √k 计
function labelBox(node, label, k) {
  const px = node.meta ? 12.5 : 11;
  const width = textWidth(node.name, px) + (node.meta ? textWidth(String(node.usage), 10) + 6 : 0);
  const x = node.x * k + label.x * Math.sqrt(k);
  const y = node.y * k + label.y * Math.sqrt(k) + parseFloat(label.dy) * px;
  const left = label.anchor === 'start' ? x : label.anchor === 'end' ? x - width : x - width / 2;
  return { left, right: left + width, top: y - px * .8, bottom: y + px * .3 };
}
const overlaps = (a, b) => a.left < b.right + 6 && b.left < a.right + 6 && a.top < b.bottom + 3 && b.top < a.bottom + 3;

function svgPoint(svg, event) {
  const matrix = svg?.getScreenCTM();
  return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : { x: GRAPH.cx, y: GRAPH.cy };
}

function matchesQuery(node, needle) {
  return `${node.name} ${node.slug} ${node.description || ''}`.toLowerCase().includes(needle);
}

export default function SkillGraph({ onClose, onOpenSkill, dataVersion }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [demo, setDemo] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [onlyConnected, setOnlyConnected] = useState(false);
  const [labels, setLabels] = useState(false);
  const [zoom, setZoom] = useState(1);
  const svgRef = useRef(null);
  const sceneRef = useRef(null);
  const searchRef = useRef(null);
  const view = useRef(IDENTITY);
  const drag = useRef(null);
  const rootRef = useRef(null);
  const starsRef = useRef(null);
  const [calm] = useState(prefersReducedMotion); // 减少动态效果：不渲染持续动画的装饰层

  // 进入视图即接管键盘（/ 搜索、+/- 缩放、Esc 返回），除非焦点已经在图谱里
  useEffect(() => {
    if (!rootRef.current?.contains(document.activeElement)) rootRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    requestJson('/api/skills/graph', { signal: controller.signal })
      .then((payload) => { setData(payload); setError(''); })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [revision, dataVersion]);

  const graph = demo ? demoGraph : data;
  const nodes = graph?.nodes || EMPTY;
  const edges = graph?.edges || EMPTY;
  const positions = useMemo(() => layoutGraph(nodes, edges), [nodes, edges]);
  const connected = useMemo(() => new Set(edges.flatMap((edge) => [edge.source, edge.target])), [edges]);
  const metaNodes = useMemo(() => [...positions.values()].filter((node) => node.meta), [positions]);
  const ranked = useMemo(() => [...metaNodes].sort((a, b) => b.usage - a.usage || a.slug.localeCompare(b.slug)), [metaNodes]);
  const maxUsage = Math.max(1, ...metaNodes.map((node) => node.usage));
  const appCount = nodes.length - metaNodes.length;
  const unlinkedCount = nodes.filter((node) => !node.meta && !connected.has(node.id)).length;

  const visible = useMemo(() => nodes.filter((node) => !onlyConnected || connected.has(node.id)), [nodes, onlyConnected, connected]);
  const visibleIds = useMemo(() => new Set(visible.map((node) => node.id)), [visible]);
  const needle = query.trim().toLowerCase();
  const matches = useMemo(() => new Set(needle ? visible.filter((node) => matchesQuery(node, needle)).map((node) => node.id) : []), [visible, needle]);

  // 悬停优先于选中：悬停只是预览，移开后回到选中节点的关系
  const activeId = hoveredId ?? selectedId;
  const neighborhood = useMemo(() => {
    const set = new Set(activeId == null ? [] : [activeId]);
    for (const edge of edges) {
      if (edge.source === activeId) set.add(edge.target);
      if (edge.target === activeId) set.add(edge.source);
    }
    return set;
  }, [edges, activeId]);
  const selected = positions.get(selectedId) || null;
  const related = useMemo(() => {
    if (!selected) return EMPTY;
    return edges
      .filter((edge) => edge.source === selected.id || edge.target === selected.id)
      .map((edge) => ({ edge, other: positions.get(edge.source === selected.id ? edge.target : edge.source) }))
      .filter(({ other }) => other)
      .sort((a, b) => a.other.name.localeCompare(b.other.name));
  }, [selected, edges, positions]);
  const visibleEdges = useMemo(() => edges.flatMap((edge) => {
    const from = positions.get(edge.source), to = positions.get(edge.target);
    if (!from || !to || !visibleIds.has(edge.source) || !visibleIds.has(edge.target)) return [];
    return [{ edge, key: `${edge.source}>${edge.target}`, d: edgePath(from, to) }];
  }), [edges, positions, visibleIds]);
  const unresolved = selected && graph?.unresolved ? graph.unresolved.filter((item) => item.source === selected.id).map((item) => item.target) : EMPTY;

  const applyView = useCallback((next, ease = false) => {
    view.current = next;
    const scene = sceneRef.current;
    if (!scene) return;
    scene.classList.toggle('is-easing', ease && !prefersReducedMotion());
    scene.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.k})`;
    // 放大时：间距按 k 拉开，节点只按 √k 长大（--node-scale），文字按 k 反向补偿保持屏幕字号
    scene.style.setProperty('--k', next.k);
    scene.style.setProperty('--node-scale', 1 / Math.sqrt(next.k));
    scene.style.setProperty('--k-node', Math.sqrt(next.k));
    // 星空只跟随 30% 的平移、20% 的缩放：远景视差
    const stars = starsRef.current;
    if (stars) {
      stars.classList.toggle('is-easing', scene.classList.contains('is-easing'));
      stars.style.transform = `translate(${next.x * .3}px, ${next.y * .3}px) scale(${1 + (next.k - 1) * .2})`;
    }
    setZoom(next.k);
  }, []);

  const zoomAround = useCallback((factor, focus = { x: GRAPH.cx, y: GRAPH.cy }, ease = false) => {
    const { x, y, k } = view.current;
    const nextK = clamp(k * factor, MIN_ZOOM, MAX_ZOOM);
    if (nextK === k) return;
    applyView({ x: focus.x - (focus.x - x) * nextK / k, y: focus.y - (focus.y - y) * nextK / k, k: nextK }, ease);
  }, [applyView]);

  const resetView = useCallback(() => applyView(IDENTITY, true), [applyView]);

  // 放大时从列表选中远处节点，把它平移到视野中央
  const reveal = useCallback((node) => {
    const { k } = view.current;
    if (!node || k <= 1.05) return;
    applyView({ x: GRAPH.cx - node.x * k, y: GRAPH.cy - node.y * k, k }, true);
  }, [applyView]);

  const pick = (id, { fromList = false } = {}) => {
    setSelectedId(id);
    setHoveredId(null);
    if (fromList) reveal(positions.get(id));
  };

  const hasCanvas = Boolean(graph);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    // 滚轮以指针为中心缩放；需要 passive: false 才能拦住页面滚动
    const onWheel = (event) => {
      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      zoomAround(Math.exp(-delta * .0016), svgPoint(svg, event));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [hasCanvas, zoomAround]);

  const switchSource = (nextDemo) => {
    if (nextDemo === demo) return;
    setDemo(nextDemo);
    setSelectedId(null);
    setHoveredId(null);
    setQuery('');
    setOnlyConnected(false);
    resetView();
  };

  const resetExploration = () => {
    pick(null);
    setQuery('');
    setOnlyConnected(false);
    resetView();
  };

  const openSkill = (node) => { if (!demo && node) onOpenSkill(node); };

  const onKeyDown = (event) => {
    const typing = event.target instanceof HTMLInputElement;
    if (event.key === 'Escape') {
      // 逐级退出：清空搜索 → 离开搜索框 → 取消选中 → 返回技能库
      if (typing) { if (query) setQuery(''); else rootRef.current?.focus({ preventScroll: true }); return; }
      if (selectedId != null || hoveredId != null) { pick(null); return; }
      onClose();
      return;
    }
    if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === '/') { event.preventDefault(); searchRef.current?.focus(); }
    else if (event.key === '+' || event.key === '=') zoomAround(1.25, undefined, true);
    else if (event.key === '-') zoomAround(.8, undefined, true);
    else if (event.key === '0') resetView();
  };

  // 标签避让：必显的（元技能、悬停/选中及其邻居、搜索命中）先占位；
  // 可选的（「全部名称」或放大后自动显示）只在不压住已有标签时出现——放大拉开间距，名字自然越显越多
  const shownLabels = useMemo(() => {
    const optional = labels || zoom >= 1.8;
    const placed = [], shown = new Set();
    const forced = [], rest = [];
    for (const raw of visible) {
      const node = positions.get(raw.id);
      const must = node.meta || node.id === activeId || node.id === selectedId || (activeId != null && neighborhood.has(node.id)) || matches.has(node.id);
      if (must) forced.push(node);
      else if (optional) rest.push(node);
    }
    rest.sort((a, b) => Number(connected.has(b.id)) - Number(connected.has(a.id)) || a.slug.localeCompare(b.slug));
    // 可选标签还要避开别的节点圆点和圆心的「未关联」字样
    const dots = visible.map((raw) => {
      const node = positions.get(raw.id);
      const r = (node.meta ? metaRadius(node.usage) + 5 : 4) * Math.sqrt(zoom);
      return { id: node.id, left: node.x * zoom - r, right: node.x * zoom + r, top: node.y * zoom - r, bottom: node.y * zoom + r };
    });
    const coreY = (GRAPH.cy + GRAPH.core) * zoom + 14;
    placed.push({ left: GRAPH.cx * zoom - 40, right: GRAPH.cx * zoom + 40, top: coreY - 9, bottom: coreY + 3 });
    for (const node of forced) { shown.add(node.id); placed.push(labelBox(node, node.meta ? metaLabel(node) : APP_LABEL, zoom)); }
    for (const node of rest) {
      const box = labelBox(node, APP_LABEL, zoom);
      if (placed.some((other) => overlaps(box, other)) || dots.some((dot) => dot.id !== node.id && overlaps(box, dot))) continue;
      shown.add(node.id);
      placed.push(box);
    }
    return shown;
  }, [visible, positions, zoom, labels, activeId, selectedId, neighborhood, matches, connected]);

  const isDimmed = (id) => (activeId != null ? !neighborhood.has(id) : Boolean(needle) && !matches.has(id));
  const sourceKey = demo ? 'demo' : 'live';

  const emptyNote = !nodes.length
    ? { title: '技能库还是空的', body: '导入或新建技能后，这里会画出它们与元技能之间的关系。', demo: true }
    : !metaNodes.length
      ? { title: '还没有元技能', body: '在 frontmatter 写 type: meta（或打上「元技能」标签），再让其他技能用 depends_on 声明依赖，外环与连线就会出现。', demo: true }
      : !visible.length
        ? { title: '没有已关联的技能', body: '关闭「仅看有关联」即可看到全部技能。' }
        : !edges.length
          ? { title: '元技能还没有被引用', body: '在应用技能的 frontmatter 写 depends_on: [元技能 slug]，连线与能量流就会从圆心汇向外环。', demo: true }
          : null;

  return (
    <main ref={rootRef} className="skill-graph" id="graph-page" tabIndex={-1} aria-label="技能依赖图" onKeyDown={onKeyDown}>
      <header className="graph-bar">
        <button type="button" className="icon-button" aria-label="返回技能库" title="返回技能库（Esc）" onClick={onClose}><ArrowLeft size={17} /></button>
        <div className="graph-title">
          <h1>技能依赖图</h1>
          {graph && (
            <p aria-live="polite">
              <span><b>{metaNodes.length}</b> 元技能</span>
              <span><b>{appCount}</b> 应用技能</span>
              <span><b>{edges.length}</b> 条关系</span>
            </p>
          )}
        </div>
        <label className="graph-search">
          <Search size={14} aria-hidden="true" />
          <span className="sr-only">搜索图中技能</span>
          <input ref={searchRef} value={query} placeholder="搜索技能…" onChange={(e) => { setQuery(e.target.value); setSelectedId(null); setHoveredId(null); }} />
          {query ? <button type="button" aria-label="清除搜索" onClick={() => { setQuery(''); searchRef.current?.focus(); }}><X size={13} /></button> : <kbd aria-hidden="true">/</kbd>}
        </label>
        <div className="graph-toggles" role="group" aria-label="显示选项">
          <button type="button" className="graph-chip" aria-pressed={onlyConnected} onClick={() => { setOnlyConnected((v) => !v); setSelectedId(null); }}>仅看有关联</button>
          <button type="button" className="graph-chip" aria-pressed={labels} onClick={() => setLabels((v) => !v)}>全部名称</button>
        </div>
        <div className="graph-source" role="group" aria-label="数据来源">
          <button type="button" aria-pressed={!demo} onClick={() => switchSource(false)}>技能库</button>
          <button type="button" aria-pressed={demo} onClick={() => switchSource(true)}>示例</button>
        </div>
      </header>

      {!demo && error ? (
        <div className="graph-state" role="alert">
          <Network size={28} aria-hidden="true" />
          <h2>依赖图暂时无法载入</h2>
          <p>{error}</p>
          <div className="graph-state-actions">
            <button type="button" className="secondary-button" onClick={() => { setError(''); setRevision((r) => r + 1); }}><RotateCw size={13} />重新加载</button>
            <button type="button" className="secondary-button" onClick={() => switchSource(true)}>查看示例</button>
          </div>
        </div>
      ) : !graph ? (
        <div className="graph-state" role="status">
          <div className="graph-loading" aria-hidden="true"><i /><i /><i /></div>
          <p>正在整理技能关系…</p>
        </div>
      ) : (
        <div className="graph-body">
          <section className="graph-canvas" aria-label="技能关系图">
            <svg
              ref={svgRef}
              className="graph-svg"
              viewBox={`0 0 ${GRAPH.width} ${GRAPH.height}`}
              role="group"
              aria-label={`${metaNodes.length} 个元技能，${appCount} 个应用技能，${edges.length} 条关系`}
              onPointerDown={(e) => {
                if (e.button !== 0 || e.target.closest('.graph-node')) return;
                drag.current = { start: svgPoint(svgRef.current, e), origin: { ...view.current }, moved: false };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!drag.current) return;
                const current = svgPoint(svgRef.current, e), { start, origin } = drag.current;
                if (!drag.current.moved && Math.hypot(current.x - start.x, current.y - start.y) < 4) return;
                drag.current.moved = true;
                e.currentTarget.classList.add('is-panning');
                applyView({ ...origin, x: origin.x + current.x - start.x, y: origin.y + current.y - start.y });
              }}
              onPointerUp={(e) => {
                if (drag.current && !drag.current.moved) pick(null);
                drag.current = null;
                e.currentTarget.classList.remove('is-panning');
              }}
              onPointerCancel={(e) => { drag.current = null; e.currentTarget.classList.remove('is-panning'); }}
            >
              <defs>
                <radialGradient id="graph-nebula">
                  <stop offset="0" stopColor="var(--accent)" stopOpacity=".16" />
                  <stop offset=".45" stopColor="var(--accent)" stopOpacity=".05" />
                  <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="graph-sweep" gradientUnits="userSpaceOnUse" x1={SWEEP.x1} y1={SWEEP.y1} x2={SWEEP.x2} y2={SWEEP.y2}>
                  <stop offset="0" stopColor="var(--accent)" stopOpacity="0" />
                  <stop offset="1" stopColor="var(--accent)" stopOpacity=".13" />
                </linearGradient>
                <filter id="graph-bloom" x="-150%" y="-150%" width="400%" height="400%">
                  <feGaussianBlur stdDeviation="4" />
                </filter>
              </defs>

              <g ref={starsRef} className="graph-stars" aria-hidden="true">
                {STARS.map((star, index) => (
                  <circle key={index} className={star.twinkle && !calm ? 'is-twinkle' : undefined} cx={star.x} cy={star.y} r={star.r} style={{ '--o': star.o, '--delay': `${star.delay}s` }} />
                ))}
              </g>

              <g ref={sceneRef} className="graph-scene">
                <circle className="graph-nebula" cx={GRAPH.cx} cy={GRAPH.cy} r={GRAPH.ring + 90} fill="url(#graph-nebula)" />
                <g className={`graph-dial${activeId != null || needle ? ' is-quiet' : ''}`} aria-hidden="true">
                  <g className="graph-ticks">
                    {TICKS.map((angle, index) => {
                      const long = index % 10 === 0;
                      const r1 = GRAPH.ring + 6, r2 = GRAPH.ring + (long ? 15 : 10);
                      return <line key={index} className={long ? 'is-long' : undefined} x1={GRAPH.cx + r1 * Math.cos(angle)} y1={GRAPH.cy + r1 * Math.sin(angle)} x2={GRAPH.cx + r2 * Math.cos(angle)} y2={GRAPH.cy + r2 * Math.sin(angle)} />;
                    })}
                  </g>
                  {!calm && metaNodes.length > 0 && (
                    <g className="graph-sweep">
                      <path d={SWEEP.d} fill="url(#graph-sweep)" />
                      <line x1={GRAPH.cx} y1={GRAPH.cy} x2={GRAPH.cx + GRAPH.ring} y2={GRAPH.cy} />
                    </g>
                  )}
                  <circle className="graph-ring" cx={GRAPH.cx} cy={GRAPH.cy} r={GRAPH.ring} pathLength="1" />
                  <circle className="graph-band" cx={GRAPH.cx} cy={GRAPH.cy} r={GRAPH.inner} />
                  <circle className="graph-core" cx={GRAPH.cx} cy={GRAPH.cy} r={GRAPH.core} />
                  {!calm && <circle className="graph-wave" cx={GRAPH.cx} cy={GRAPH.cy} r={GRAPH.core} />}
                  {unlinkedCount > 0 && !onlyConnected && <text className="graph-core-label" x={GRAPH.cx} y={GRAPH.cy + GRAPH.core} dy="1.4em" textAnchor="middle">未关联 · {unlinkedCount}</text>}
                </g>

                <g className="graph-edges" key={`edges-${sourceKey}`}>
                  {visibleEdges.map(({ edge, key, d }, index) => {
                    const lit = activeId != null && (edge.source === activeId || edge.target === activeId);
                    const faded = activeId != null ? !lit : Boolean(needle) && !matches.has(edge.source) && !matches.has(edge.target);
                    const reference = edge.kind === 'reference';
                    return (
                      <g key={key}>
                        {lit && <path className="graph-edge-bloom" d={d} filter="url(#graph-bloom)" />}
                        <path
                          className={`graph-edge${reference ? ' is-reference' : ''}${lit ? ' is-lit' : ''}${faded ? ' is-faded' : ''}`}
                          style={{ '--delay': `${650 + (index % 30) * 22}ms` }}
                          pathLength={reference ? undefined : 1}
                          d={d}
                        />
                      </g>
                    );
                  })}
                </g>

                {/* 能量粒子：从应用技能沿连线汇入元技能，越靠近越快 */}
                {!calm && (
                  <g className="graph-particles" key={`particles-${sourceKey}`} aria-hidden="true">
                    {visibleEdges.slice(0, MAX_PARTICLES).map(({ edge, key, d }, index) => {
                      const lit = activeId != null && (edge.source === activeId || edge.target === activeId);
                      const faded = activeId != null ? !lit : Boolean(needle) && !matches.has(edge.source) && !matches.has(edge.target);
                      const duration = `${2.8 + (index % 7) * .38}s`;
                      const begin = `${-((index * .83) % 3.4).toFixed(2)}s`;
                      return (
                        <circle key={key} className={`graph-particle${lit ? ' is-lit' : ''}${faded ? ' is-faded' : ''}`} r={lit ? 2.3 : 1.6}>
                          <animateMotion dur={duration} begin={begin} repeatCount="indefinite" path={d} calcMode="spline" keyTimes="0;1" keySplines=".5 0 .9 .6" />
                          <animate attributeName="opacity" dur={duration} begin={begin} repeatCount="indefinite" values="0;1;1;0" keyTimes="0;.2;.85;1" />
                        </circle>
                      );
                    })}
                  </g>
                )}

                <g className="graph-nodes" key={`nodes-${sourceKey}`}>
                  {visible.map((raw, order) => {
                    const node = positions.get(raw.id);
                    const active = node.id === activeId;
                    const isSelected = node.id === selectedId;
                    const neighbor = activeId != null && !active && neighborhood.has(node.id);
                    const dim = isDimmed(node.id);
                    const radius = Math.hypot(node.x - GRAPH.cx, node.y - GRAPH.cy);
                    // 入场：所有节点从圆心迸发，按离心距离依次落位；元技能最后抵达外环
                    const delay = node.meta ? 380 + metaNodes.indexOf(node) * 60 : 120 + radius * 1.4;
                    const showName = shownLabels.has(node.id);
                    const label = node.meta ? metaLabel(node) : APP_LABEL;
                    const size = node.meta ? metaRadius(node.usage) : 3.6;
                    return (
                      <g
                        key={node.id}
                        className={`graph-node${node.meta ? ' is-meta' : ''}${node.meta || connected.has(node.id) ? '' : ' is-loose'}${active ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}${neighbor ? ' is-neighbor' : ''}${dim ? ' is-dim' : ''}${matches.has(node.id) ? ' is-match' : ''}`}
                        transform={`translate(${node.x} ${node.y})`}
                        role="button"
                        tabIndex={0}
                        aria-label={`${node.meta ? '元技能' : '应用技能'}：${node.name}`}
                        aria-pressed={isSelected}
                        onMouseEnter={() => setHoveredId(node.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        onFocus={() => setHoveredId(node.id)}
                        onBlur={() => setHoveredId(null)}
                        onClick={() => pick(isSelected ? null : node.id)}
                        onDoubleClick={() => openSkill(node)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && isSelected) { e.preventDefault(); openSkill(node); }
                          else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(node.id); }
                        }}
                      >
                        <title>{node.meta ? `${node.name} · 被 ${node.usage} 个技能使用` : node.name}</title>
                        <g className="graph-node-body" style={{ '--delay': `${Math.round(delay)}ms`, '--fx': `${GRAPH.cx - node.x}px`, '--fy': `${GRAPH.cy - node.y}px` }}>
                          <circle className="graph-node-hit" r={node.meta ? 20 : 11} />
                          <g className="graph-float" style={{ '--float-delay': `${-((order * 1.37) % 6).toFixed(2)}s`, '--float-dur': `${5 + (order % 5) * .7}s` }}>
                            {isSelected && <circle className="graph-node-pulse" r={size} />}
                            {node.meta && <circle className="graph-node-bloom" r={size + 3} filter="url(#graph-bloom)" />}
                            {node.meta && <circle className="graph-node-orbit" r={size + 9} />}
                            {node.meta && <circle className="graph-node-halo" r={size + 4.5} />}
                            <circle className="graph-node-dot" r={size} />
                          </g>
                          {showName && (
                            <text className="graph-node-label" x={label.x} y={label.y} dy={label.dy} textAnchor={label.anchor}>
                              {node.name}
                              {node.meta && <tspan className="graph-node-count" dx=".5em">{node.usage}</tspan>}
                            </text>
                          )}
                        </g>
                      </g>
                    );
                  })}
                </g>
              </g>
            </svg>

            {demo && <div className="graph-badge">示例数据 · 不代表真实依赖</div>}

            {emptyNote && (
              <div className="graph-empty" role="status">
                <h2>{emptyNote.title}</h2>
                <p>{emptyNote.body}</p>
                {!demo && emptyNote.demo && <button type="button" className="secondary-button" onClick={() => switchSource(true)}>看看示例 <ArrowUpRight size={13} /></button>}
              </div>
            )}

            <div className="graph-legend" aria-hidden="true">
              <span><i className="key-meta" />元技能</span>
              <span><i className="key-app" />应用技能</span>
              <span><i className="key-loose" />未关联</span>
              <span><i className="key-line" />声明依赖</span>
              <span><i className="key-line is-dashed" />文档引用</span>
            </div>

            <div className="graph-zoom" role="group" aria-label="缩放">
              <button type="button" aria-label="缩小" title="缩小（-）" disabled={zoom <= MIN_ZOOM + .001} onClick={() => zoomAround(.8, undefined, true)}><Minus size={14} /></button>
              <button type="button" className="graph-zoom-value" aria-label="重置视图" title="重置视图（0）" onClick={resetView}>{Math.round(zoom * 100)}%</button>
              <button type="button" aria-label="放大" title="放大（+）" disabled={zoom >= MAX_ZOOM - .001} onClick={() => zoomAround(1.25, undefined, true)}><Plus size={14} /></button>
            </div>
          </section>

          <aside className="graph-inspector" aria-label="关系详情">
            <div className="graph-panel" key={selected ? `node-${selected.id}` : needle ? 'search' : 'overview'}>
              {selected ? (
                <>
                  <div className="graph-panel-head">
                    <span className={`graph-kind${selected.meta ? ' is-meta' : ''}`}>{selected.meta ? '元技能' : '应用技能'}</span>
                    <button type="button" className="icon-button" aria-label="取消选择" onClick={() => pick(null)}><X size={14} /></button>
                  </div>
                  <h2>{selected.name}</h2>
                  <p className="graph-slug">{selected.slug}{selected.folder ? ` · ${selected.folder}` : ''}</p>
                  <p className="graph-description">{selected.description || '此技能尚未添加描述。'}</p>
                  {!demo && (
                    <button type="button" className="primary-button graph-open" onClick={() => openSkill(selected)}>
                      打开技能 <ArrowUpRight size={14} />
                    </button>
                  )}
                  <h3 className="graph-section-title">
                    {selected.meta ? '使用它的技能' : '依赖的元技能'}<span>{related.length}</span>
                  </h3>
                  {related.length ? (
                    <ul className="graph-list">
                      {related.map(({ edge, other }) => (
                        <li key={`${edge.source}>${edge.target}`}>
                          <button type="button" onClick={() => pick(other.id, { fromList: true })} onMouseEnter={() => setHoveredId(other.id)} onMouseLeave={() => setHoveredId(null)}>
                            <span className={`graph-list-dot${other.meta ? ' is-meta' : ''}`} />
                            <span className="graph-list-name">{other.name}</span>
                            <span className={`graph-tag${edge.kind === 'reference' ? ' is-reference' : ''}`}>{edge.kind === 'reference' ? '引用' : '依赖'}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="graph-hint">{selected.meta ? '还没有技能声明依赖它。' : '没有声明任何元技能依赖。'}</p>
                  )}
                  {unresolved.length > 0 && <p className="graph-note">未在技能库中找到：{unresolved.join('、')}</p>}
                  {selected.warning && <p className="graph-note">frontmatter 无法解析，依赖声明被忽略。</p>}
                  {!demo && <p className="graph-foot-hint">双击节点也能打开技能</p>}
                </>
              ) : needle ? (
                <>
                  <div className="graph-panel-head"><span>搜索结果</span></div>
                  <h2 className="graph-count-title">{matches.size ? `${matches.size} 个匹配` : '没有匹配的技能'}</h2>
                  {matches.size ? (
                    <ul className="graph-list">
                      {visible.filter((node) => matches.has(node.id)).map((node) => (
                        <li key={node.id}>
                          <button type="button" onClick={() => pick(node.id, { fromList: true })} onMouseEnter={() => setHoveredId(node.id)} onMouseLeave={() => setHoveredId(null)}>
                            <span className={`graph-list-dot${node.meta ? ' is-meta' : ''}`} />
                            <span className="graph-list-name">{node.name}</span>
                            {node.slug !== node.name && <span className="graph-list-meta">{node.slug}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="graph-hint">换个关键词，{onlyConnected ? '或关闭「仅看有关联」。' : '名称、slug 与描述都会被搜索。'}</p>}
                </>
              ) : (
                <>
                  <div className="graph-panel-head"><span>概览</span></div>
                  <dl className="graph-stats">
                    <div><dt>元技能</dt><dd className="is-accent">{metaNodes.length}</dd></div>
                    <div><dt>已关联</dt><dd>{appCount - unlinkedCount}</dd></div>
                    <div><dt>未关联</dt><dd>{unlinkedCount}</dd></div>
                  </dl>
                  {ranked.length ? (
                    <>
                      <h3 className="graph-section-title">元技能使用度<span>{ranked.length}</span></h3>
                      <ul className="graph-list">
                        {ranked.map((node) => (
                          <li key={node.id}>
                            <button type="button" className="graph-usage" onClick={() => pick(node.id, { fromList: true })} onMouseEnter={() => setHoveredId(node.id)} onMouseLeave={() => setHoveredId(null)}>
                              <span className="graph-list-name">{node.name}</span>
                              <span className="graph-list-count">{node.usage}</span>
                              <span className="graph-usage-bar" style={{ '--share': node.usage / maxUsage }} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="graph-hint">还没有元技能。元技能是被其他技能复用的基础能力，例如验收规范、调试方法。</p>
                  )}
                  <details className="graph-rules">
                    <summary>关系是怎么识别的</summary>
                    <ul>
                      <li>元技能：frontmatter 写 <code>type: meta</code>，或带 <code>元技能</code> / <code>meta</code> 标签，或描述以「【元技能】」开头，或放在「元技能」目录。</li>
                      <li>实线：<code>depends_on</code>、<code>dependencies</code>、<code>requires</code> 里声明的 slug。</li>
                      <li>虚线：正文里指向 <code>&lt;slug&gt;/SKILL.md</code> 的本地链接；或者某一行写了「元技能」/ meta-skill 并给出元技能的完整 slug，如「见元技能 <code>verification-discipline</code>」。代码块内的都不算。</li>
                      <li>只画指向元技能的关系；没有关键字的随口提及不会被当成关系。</li>
                    </ul>
                  </details>
                </>
              )}
            </div>
            <footer className="graph-inspector-foot">
              <span>拖动平移 · 滚轮缩放 · <kbd>/</kbd> 搜索</span>
              <button type="button" onClick={resetExploration} title="清空选择、搜索与缩放"><Focus size={12} />复位</button>
            </footer>
          </aside>
        </div>
      )}
    </main>
  );
}
