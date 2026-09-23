// 连续命中、前缀命中加分；没有按顺序匹配到全部字符则返回零。
export function fuzzyScore(query, text) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) {
    return t.startsWith(q) ? 100 - t.length * 0.1 : 60 - t.length * 0.1;
  }
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (let qi = 0; qi < q.length; qi += 1) {
    const ch = q[qi];
    let found = -1;
    for (let i = ti; i < t.length; i += 1) {
      if (t[i] === ch) { found = i; break; }
    }
    if (found === -1) return 0;
    streak = found === ti ? streak + 1 : 1;
    score += 10 + streak * 2 + (found === 0 ? 8 : 0);
    ti = found + 1;
  }
  return score;
}
