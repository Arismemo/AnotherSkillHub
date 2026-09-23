import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Check, Circle, Focus, Layers, Network, RotateCcw, Search, X, ZoomIn, ZoomOut } from 'lucide-react';
import { requestJson } from '../utils/requestJson';
import { demoGraph, layoutGraph } from '../utils/graphLayout';
import './SkillGraph.css';

const EMPTY = [];

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
  const pan = useRef({ x: 0, y: 0 });
  const drag = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    requestJson('/api/skills/graph', { signal: controller.signal }).then(setData).catch((e) => {
      if (e.name !== 'AbortError') setError(e.message);
    });
    return () => controller.abort();
  }, [revision, dataVersion]);

  const graph = demo ? demoGraph : data;
  const nodes = graph?.nodes || EMPTY;
  const edges = graph?.edges || EMPTY;
  const positions = useMemo(() => layoutGraph(graph?.nodes || EMPTY), [graph]);
  const connected = useMemo(() => new Set(edges.flatMap((edge) => [edge.source, edge.target])), [edges]);
  const visible = nodes.filter((node) => !onlyConnected || connected.has(node.id));
  const needle = query.trim().toLowerCase();
  const matches = new Set(visible.filter((node) => `${node.name} ${node.slug} ${node.description}`.toLowerCase().includes(needle)).map((node) => node.id));
  const activeId = hoveredId ?? selectedId;
  const neighborhood = new Set([activeId]);
  edges.forEach((edge) => { if (edge.source === activeId || edge.target === activeId) { neighborhood.add(edge.source); neighborhood.add(edge.target); } });
  const dimmed = (node) => activeId != null ? !neighborhood.has(node.id) : needle && !matches.has(node.id);
  const selected = positions.get(selectedId);
  const metaNodes = nodes.filter((node) => node.meta);
  const related = selected ? edges.filter((edge) => edge.source === selected.id || edge.target === selected.id) : [];
  const ranked = [...metaNodes].sort((a, b) => edges.filter((e) => e.target === b.id).length - edges.filter((e) => e.target === a.id).length);
  const pick = (id) => { setSelectedId(id); setHoveredId(null); };
  const resetView = () => { setZoom(1); pan.current = { x: 0, y: 0 }; sceneRef.current?.setAttribute('transform', 'translate(0 0)'); };
  const switchSource = () => { setDemo(!demo); setSelectedId(null); setHoveredId(null); setQuery(''); setOnlyConnected(false); resetView(); };
  const point = (event) => {
    const matrix = svgRef.current?.getScreenCTM();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : { x: 0, y: 0 };
  };

  return (
    <main className="skill-graph" id="graph-page" tabIndex={-1} onKeyDown={(event) => {
      if (event.key === 'Escape') { setSelectedId(null); setHoveredId(null); setQuery(''); }
    }}>
      <header className="graph-header">
        <div className="graph-heading">
          <button className="icon-button" aria-label="返回技能库" onClick={onClose}><ArrowLeft size={18} /></button>
          <div><div className="graph-breadcrumb">技能库 <span>/</span> 关系探索</div><h1>技能依赖图 <span>Skill constellation</span></h1></div>
        </div>
        <button className={`secondary-button graph-source ${demo ? 'is-demo' : ''}`} onClick={switchSource}><Layers size={14} />{demo ? '示例数据 · 切回技能库' : '查看示例图'}</button>
      </header>
      <div className="graph-toolbar">
        <label className="graph-search"><Search size={16} /><span className="sr-only">搜索图中技能</span><input value={query} onChange={(e) => { setQuery(e.target.value); setSelectedId(null); setHoveredId(null); }} placeholder="搜索名称或描述…" />{query && <button aria-label="清除搜索" onClick={() => setQuery('')}><X size={14} /></button>}</label>
        <label className="graph-check"><input type="checkbox" checked={onlyConnected} onChange={(e) => { setOnlyConnected(e.target.checked); setSelectedId(null); }} />仅看有关联</label>
        <label className="graph-check"><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} />显示名称</label>
        <span className="graph-scope">{demo ? '示例关系，仅供设计预览' : '全库视图 · 不含废纸篓'}</span>
      </div>
      {!demo && error ? <div className="graph-state" role="alert"><Network size={36} /><h2>依赖图暂时无法载入</h2><p>{error}</p><button className="secondary-button" onClick={() => { setError(''); setRevision((r) => r + 1); }}>重新加载</button></div> : !graph ? <div className="graph-state" role="status"><div className="graph-loading-ring" /><p>正在整理技能关系…</p></div> : <>
        <div className="graph-workspace">
          <section className="graph-canvas" aria-label="圆形技能关系图">
            <div className="graph-canvas-heading"><Network size={16} /><span>能力之间，自有引力。</span></div>
            <div className="graph-canvas-legend"><span><i className="legend-meta" />元技能 · 外圈</span><span><i />应用技能 · 圈内</span></div>
            <svg ref={svgRef} className="graph-svg" role="group" viewBox="0 0 1000 800" aria-label={`${metaNodes.length} 个元技能，${nodes.length - metaNodes.length} 个应用技能，${edges.length} 条关系`} onPointerDown={(e) => {
              if (e.button !== 0 || e.target.closest('[role="button"]')) return;
              const start = point(e); drag.current = { start, origin: { ...pan.current }, moved: false }; e.currentTarget.setPointerCapture(e.pointerId);
            }} onPointerMove={(e) => {
              if (!drag.current) return;
              const current = point(e), { start, origin } = drag.current;
              if (Math.hypot(current.x - start.x, current.y - start.y) > 4) drag.current.moved = true;
              pan.current = { x: origin.x + current.x - start.x, y: origin.y + current.y - start.y };
              sceneRef.current?.setAttribute('transform', `translate(${pan.current.x} ${pan.current.y})`);
            }} onPointerUp={() => { if (drag.current && !drag.current.moved) pick(null); drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
              <g ref={sceneRef}><g transform={`translate(500 400) scale(${zoom}) translate(-500 -400)`}>
                <circle className="graph-orbit-inner" cx="500" cy="400" r="248" />
                <circle className="graph-orbit-inner" cx="500" cy="400" r="155" />
                <circle className="graph-orbit" cx="500" cy="400" r="310" />
                <path className="graph-crosshair" d="M 490 400 H 510 M 500 390 V 410" />
                {edges.map((edge) => {
                  const from = positions.get(edge.source), to = positions.get(edge.target);
                  if (!from || !to) return null;
                  const highlight = activeId != null && (edge.source === activeId || edge.target === activeId);
                  const faded = activeId != null ? !highlight : needle && !matches.has(edge.source) && !matches.has(edge.target);
                  return <path key={`${edge.source}-${edge.target}`} className={`graph-edge ${highlight ? 'is-highlighted' : ''} ${faded ? 'is-dimmed' : ''} ${edge.kind === 'reference' ? 'is-reference' : ''}`} d={`M ${from.x} ${from.y} Q ${(from.x + to.x) / 2 * .8 + 100} ${(from.y + to.y) / 2 * .8 + 80} ${to.x} ${to.y}`} />;
                })}
                {visible.map((node) => {
                  const { x, y } = positions.get(node.id);
                  const active = node.id === activeId;
                  const showName = node.meta || labels || active || (needle && matches.has(node.id));
                  const right = x >= 500;
                  return <g key={node.id} role="button" tabIndex={0} aria-label={`${node.meta ? '元技能' : '应用技能'}：${node.name}`} aria-pressed={node.id === selectedId} className={`graph-node ${node.meta ? 'is-meta' : ''} ${active ? 'is-active' : ''} ${dimmed(node) ? 'is-dimmed' : ''}`} transform={`translate(${x} ${y})`} onMouseEnter={() => setHoveredId(node.id)} onMouseLeave={() => setHoveredId(null)} onFocus={() => setHoveredId(node.id)} onBlur={() => setHoveredId(null)} onClick={() => pick(node.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(node.id); } }}>
                    <title>{`${node.name}\n${node.slug}`}</title>
                    <circle className="graph-node-hit" r="17" />
                    <circle className="graph-node-halo" r={node.meta ? 17 : 12} />
                    <circle className="graph-node-dot" r={node.meta ? 7 : 4.5} />
                    {showName && <text className="graph-node-label" x={node.meta ? (Math.abs(x - 500) < 30 ? 0 : right ? 22 : -22) : 11} y={node.meta && Math.abs(x - 500) < 30 ? (y < 400 ? -27 : 34) : 4} textAnchor={node.meta ? (Math.abs(x - 500) < 30 ? 'middle' : right ? 'start' : 'end') : 'start'}>{node.meta ? node.name : node.slug}</text>}
                  </g>;
                })}
              </g></g>
            </svg>
            {(!visible.length || !metaNodes.length) && <div className="graph-empty-note"><h2>{!nodes.length ? '让技能连接起来' : !visible.length ? '没有符合筛选条件的技能' : '还没有识别到元技能'}</h2><p>{!visible.length && nodes.length ? '取消「仅看有关联」即可查看全部技能。' : '在技能中标记元技能并声明依赖，即可生成真实连线。'}</p>{!demo && <button className="secondary-button" onClick={switchSource}>查看示例图 <ArrowUpRight size={14} /></button>}</div>}
            <div className="graph-canvas-bottom"><span>拖动画布平移 · 点击节点查看关系</span><div className="graph-zoom"><button aria-label="缩小图谱" disabled={zoom <= .6} onClick={() => setZoom((z) => Math.max(.6, +(z - .2).toFixed(1)))}><ZoomOut size={16} /></button><output>{Math.round(zoom * 100)}%</output><button aria-label="放大图谱" disabled={zoom >= 2.4} onClick={() => setZoom((z) => Math.min(2.4, +(z + .2).toFixed(1)))}><ZoomIn size={16} /></button><button aria-label="重置视图" onClick={resetView}><Focus size={16} /></button></div></div>
          </section>
          <aside className="graph-inspector" aria-label="关系详情">
            <div className="graph-inspector-top"><span>{selected ? '节点详情' : needle ? '搜索结果' : '图谱概览'}</span>{selected && <button className="icon-button" aria-label="取消选择" onClick={() => pick(null)}><X size={15} /></button>}</div>
            {selected ? <>
              <div className={`graph-kind ${selected.meta ? 'is-meta' : ''}`}><Circle size={13} />{selected.meta ? '元技能 · 基础能力' : '应用技能'}</div>
              <h2>{selected.name}</h2><p className="graph-slug">{selected.slug}</p><p className="graph-description">{selected.description || '此技能尚未添加描述。'}</p>
              <div className="graph-relation-title"><h3>{selected.meta ? '被哪些技能使用' : '关联的元技能'}</h3><span>{related.length}</span></div>
              {related.length ? <div className="graph-node-list">{related.map((edge) => { const other = positions.get(edge.source === selected.id ? edge.target : edge.source); return <button key={`${edge.source}-${edge.target}`} onClick={() => pick(other.id)}><span>{other.name}<small>{edge.kind === 'dependency' ? '声明依赖' : '文档引用'}</small></span><ArrowUpRight size={14} /></button>; })}</div> : <p className="graph-hint">没有已识别的元技能关系。</p>}
              {selected.warning && <p className="graph-hint">此技能的 YAML 无法解析，请检查源文件。</p>}
              {graph.unresolved?.some((item) => item.source === selected.id) && <p className="graph-hint">部分依赖未在技能库中找到：{graph.unresolved.filter((item) => item.source === selected.id).map((item) => item.target).join('、')}</p>}
              {!demo && <button className="secondary-button graph-open" onClick={() => onOpenSkill(selected)}>打开技能 <ArrowUpRight size={14} /></button>}
            </> : needle ? <><h2>{matches.size} 个匹配技能</h2><div className="graph-node-list">{visible.filter((node) => matches.has(node.id)).map((node) => <button key={node.id} onClick={() => pick(node.id)}><span>{node.name}<small>{node.meta ? '元技能' : '应用技能'}</small></span><ArrowUpRight size={14} /></button>)}</div>{!matches.size && <p className="graph-hint">试试其他名称，或取消关联筛选。</p>}</> : <>
              <h2>从基础能力，<br />看见技能全貌。</h2><p className="graph-description">外圈承载可复用的元技能，圈内的每个点是一项应用技能。</p>
              <div className="graph-stats"><div><strong>{metaNodes.length.toString().padStart(2, '0')}</strong><span>元技能</span></div><div><strong>{(nodes.length - metaNodes.length).toString().padStart(2, '0')}</strong><span>应用技能</span></div><div><strong>{edges.length.toString().padStart(2, '0')}</strong><span>关联关系</span></div></div>
              <div className="graph-relation-title"><h3>基础能力分布</h3><span>{metaNodes.length}</span></div>
              <div className="graph-node-list">{ranked.map((node) => <button key={node.id} onClick={() => pick(node.id)}><span>{node.name}<small>{node.slug}</small></span><b>{edges.filter((edge) => edge.target === node.id).length}</b></button>)}</div>
              {!metaNodes.length && <p className="graph-hint">尚未识别到元技能。可以先查看示例，了解图谱的组织方式。</p>}
              <div className="graph-tip"><Network size={17} /><p>选择一个元技能，即可看到它支撑的应用技能。选择圈内节点，追溯它使用的基础能力。</p></div>
            </>}
            <details className="graph-rules"><summary>图谱如何生成</summary><p>元技能通过 <code>type: meta</code>、元技能标签或描述前缀「【元技能】」识别。</p><p><code>depends_on: [skill-slug]</code> 等声明生成实线；指向其他技能 SKILL.md 的本地 Markdown 链接生成引用虚线。只展示指向元技能的关系。</p><p>未识别的关系不会推测补全。示例数据不会写入技能库。</p></details>
          </aside>
        </div>
        <footer className="graph-footer"><div><span className="graph-line-key" />声明依赖<span className="graph-line-key is-reference" />文档引用</div><span>{demo ? <><Layers size={13} />示例数据</> : <><Check size={13} />真实技能库</>}<span className="graph-footer-separator">·</span>{nodes.length - connected.size} 个技能暂无关联</span><button onClick={() => { pick(null); setQuery(''); setOnlyConnected(false); resetView(); }}><RotateCcw size={13} />重置探索</button></footer>
      </>}
    </main>
  );
}
