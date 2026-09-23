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

const metaRadius = (usage) => 5.5 + Math.min(6.5, Math.sqrt(usage) * 1.5);

// 元技能名称沿径向朝外排：左半圆右对齐、右半圆左对齐、正上下居中
function metaLabel(node) {
  const cos = Math.cos(node.angle), sin = Math.sin(node.angle);
  const distance = metaRadius(node.usage) + 11;
  const anchor = cos > .3 ? 'start' : cos < -.3 ? 'end' : 'middle';
  const lift = anchor === 'middle' ? (sin > 0 ? 11 : -3) : 4;
  return { x: cos * distance, y: sin * distance + lift, anchor };
}

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
  const unresolved = selected && graph?.unresolved ? graph.unresolved.filter((item) => item.source === selected.id).map((item) => item.target) : EMPTY;

  const applyView = useCallback((next, ease = false) => {
    view.current = next;
    const scene = sceneRef.current;
    if (!scene) return;
    scene.classList.toggle('is-easing', ease && !prefersReducedMotion());
    scene.style.transform = `translate(${next.x}px, ${next.y}px) scale(${next.k})`;
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

  const isDimmed = (id) => (activeId != null ? !neighborhood.has(id) : Boolean(needle) && !matches.has(id));
  const sourceKey = demo ? 'demo' : 'live';

  const emptyNote = !nodes.length
    ? { title: '技能库还是空的', body: '导入或新建技能后，这里会画出它们与元技能之间的关系。', demo: true }
    : !metaNodes.length
      ? { title: '还没有元技能', body: '在 frontmatter 写 type: meta（或打上「元技能」标签），再让其他技能用 depends_on 声明依赖，外环与连线就会出现。', demo: true }
      : !visible.length
        ? { title: '没有已关联的技能', body: '关闭「仅看有关联」即可看到全部技能。' }
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
                <radialGradient id="graph-glow">
                  <stop offset="0" stopColor="var(--accent)" stopOpacity=".09" />
                  <stop offset=".62" stopColor="var(--accent)" stopOpacity=".025" />
                  <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
                </radialGradient>
              </defs>
              <g ref={sceneRef} className="graph-scene">
                <circle className="graph-glow" cx={GRAPH.cx} cy={GRAPH.cy} r={GRAPH.ring + 40} fill="url(#graph-glow)" />
                <g className="graph-dial" aria-hidden="true">
                  {TICKS.map((angle, index) => {
                    const long = index % 10 === 0;
                    const r1 = GRAPH.ring + 5, r2 = GRAPH.ring + (long ? 13 : 9);
                    return <line key={index} className={long ? 'is-long' : undefined} x1={GRAPH.cx + r1 * Math.cos(angle)} y1={GRAPH.cy + r1 * Math.sin(angle)} x2={GRAPH.cx + r2 * Math.cos(angle)} y2={GRAPH.cy + r2 * Math.sin(angle)} />;
                  })}
                  <circle className="graph-ring" cx={GRAPH.cx} cy={GRAPH.cy} r={GRAPH.ring} />
                  <circle className="graph-band" cx={GRAPH.cx} cy={GRAPH.cy} r={GRAPH.inner} />
                  <circle className="graph-core" cx={GRAPH.cx} cy={GRAPH.cy} r={GRAPH.core} />
                  {unlinkedCount > 0 && !onlyConnected && <text className="graph-core-label" x={GRAPH.cx} y={GRAPH.cy + GRAPH.core + 14} textAnchor="middle">未关联 · {unlinkedCount}</text>}
                </g>

                <g className="graph-edges" key={`edges-${sourceKey}`}>
                  {edges.map((edge, index) => {
                    const from = positions.get(edge.source), to = positions.get(edge.target);
                    if (!from || !to || !visibleIds.has(edge.source) || !visibleIds.has(edge.target)) return null;
                    const lit = activeId != null && (edge.source === activeId || edge.target === activeId);
                    const faded = activeId != null ? !lit : Boolean(needle) && !matches.has(edge.source) && !matches.has(edge.target);
                    const reference = edge.kind === 'reference';
                    return (
                      <path
                        key={`${edge.source}>${edge.target}`}
                        className={`graph-edge${reference ? ' is-reference' : ''}${lit ? ' is-lit' : ''}${faded ? ' is-faded' : ''}`}
                        style={{ '--delay': `${420 + (index % 24) * 18}ms` }}
                        pathLength={reference ? undefined : 1}
                        d={edgePath(from, to)}
                      />
                    );
                  })}
                </g>

                <g className="graph-nodes" key={`nodes-${sourceKey}`}>
                  {visible.map((raw) => {
                    const node = positions.get(raw.id);
                    const active = node.id === activeId;
                    const isSelected = node.id === selectedId;
                    const dim = isDimmed(node.id);
                    const radius = Math.hypot(node.x - GRAPH.cx, node.y - GRAPH.cy);
                    const delay = node.meta ? metaNodes.indexOf(node) * 45 : 160 + radius * 1.1;
                    const showName = node.meta || labels || zoom >= 1.8 || active || isSelected || (neighborhood.has(node.id) && activeId != null) || matches.has(node.id);
                    const label = node.meta ? metaLabel(node) : { x: 8, y: 3.5, anchor: 'start' };
                    return (
                      <g
                        key={node.id}
                        className={`graph-node${node.meta ? ' is-meta' : ''}${node.meta || connected.has(node.id) ? '' : ' is-loose'}${active ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}${dim ? ' is-dim' : ''}${matches.has(node.id) ? ' is-match' : ''}`}
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
                        <g className="graph-node-body" style={{ '--delay': `${Math.round(delay)}ms` }}>
                          <circle className="graph-node-hit" r={node.meta ? 20 : 11} />
                          {isSelected && <circle className="graph-node-pulse" r={node.meta ? metaRadius(node.usage) : 4} />}
                          {node.meta && <circle className="graph-node-halo" r={metaRadius(node.usage) + 5} />}
                          <circle className="graph-node-dot" r={node.meta ? metaRadius(node.usage) : 3.6} />
                          {showName && (
                            <text className="graph-node-label" x={label.x} y={label.y} textAnchor={label.anchor}>
                              {node.name}
                              {node.meta && <tspan className="graph-node-count" dx="6">{node.usage}</tspan>}
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
                      <li>虚线：正文里指向 <code>&lt;slug&gt;/SKILL.md</code> 的本地链接（代码块内的不算）。</li>
                      <li>只画指向元技能的关系，不根据正文提及去猜测。</li>
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
