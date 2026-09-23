// 行级差异（LCS）：审核 Agent 提交的更新、对比历史版本时使用。技能正文通常几百行，O(n·m) 足够。
const MAX_CELLS = 4_000_000;

export function diffLines(before, after) {
  const a = String(before ?? '').split('\n');
  const b = String(after ?? '').split('\n');
  // 去掉公共前后缀，缩小 LCS 表
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1; }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const middle = [];
  if (midA.length * midB.length > MAX_CELLS) {
    // 超大改动退化为整段替换，避免卡住页面
    midA.forEach((text) => middle.push({ type: 'del', text }));
    midB.forEach((text) => middle.push({ type: 'add', text }));
  } else {
    const n = midA.length;
    const m = midB.length;
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { middle.push({ type: 'same', text: midA[i] }); i += 1; j += 1; }
      else if (table[i + 1][j] >= table[i][j + 1]) { middle.push({ type: 'del', text: midA[i] }); i += 1; }
      else { middle.push({ type: 'add', text: midB[j] }); j += 1; }
    }
    while (i < n) { middle.push({ type: 'del', text: midA[i] }); i += 1; }
    while (j < m) { middle.push({ type: 'add', text: midB[j] }); j += 1; }
  }

  return [
    ...a.slice(0, start).map((text) => ({ type: 'same', text })),
    ...middle,
    ...a.slice(endA).map((text) => ({ type: 'same', text })),
  ];
}

// 只保留改动附近 context 行，其余折叠成 { type: 'skip', count }
export function collapseDiff(lines, context = 3) {
  const keep = new Array(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.type === 'same') return;
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k += 1) keep[k] = true;
  });
  const out = [];
  let skipped = 0;
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (skipped) { out.push({ type: 'skip', count: skipped }); skipped = 0; }
      out.push(line);
    } else {
      skipped += 1;
    }
  });
  if (skipped) out.push({ type: 'skip', count: skipped });
  return out;
}

export function diffStats(lines) {
  return lines.reduce((acc, line) => {
    if (line.type === 'add') acc.added += 1;
    if (line.type === 'del') acc.removed += 1;
    return acc;
  }, { added: 0, removed: 0 });
}

// 附属文件变化：按路径对比新增 / 删除 / 修改
export function diffFileLists(before = [], after = []) {
  const oldMap = new Map(before.map((f) => [f.path, f.content]));
  const newMap = new Map(after.map((f) => [f.path, f.content]));
  const added = [...newMap.keys()].filter((p) => !oldMap.has(p));
  const removed = [...oldMap.keys()].filter((p) => !newMap.has(p));
  const changed = [...newMap.keys()].filter((p) => oldMap.has(p) && oldMap.get(p) !== newMap.get(p));
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}
