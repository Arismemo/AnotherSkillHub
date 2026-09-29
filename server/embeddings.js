// 可选的语义层：配置了向量模型后，查重与按任务找技能在「中英文写法不同」的情况下也能对上——
// 纯文本比对对这种情况是瞎的（中文写的技能和英文写的同类技能没有一个共同的词）。
//
// 配置（都不设时一切照旧，只用文本比对）：
//   ASH_EMBED_URL    Ollama 地址（如 http://127.0.0.1:11434），或 OpenAI 兼容接口（以 /v1 结尾）
//   ASH_EMBED_MODEL  模型名，默认 bge-m3（多语言；Ollama 上 ollama pull bge-m3）
//   ASH_EMBED_KEY    OpenAI 兼容接口的 API key（可选）
//   ASH_EMBED_QUERY_TIMEOUT_MS  查询向量（ash suggest）最多等多久，默认 8000；超时就只用文本比对
//
// 模型可能跑在繁忙服务器的 CPU 上（实测 seed-SER9 上 bge-m3 每条约 3.5 秒）：后台补齐按小批次进行、
// 超时随批次大小放宽，新技能优先；查询向量单独设较短的超时，找技能不会被慢模型拖住。
//
// 语义分数只在文本比对看不见的地方补位（见 skillIndex）：同语言的同系列技能语义上很像却不是重复，
// 所以相似度只对主语言不同的两个技能用语义；按任务找技能时取文本、语义两者较高的相关度。
// 向量按「模型 + 文本」的哈希存进 skill_embeddings，内容不变就不重算；模型服务不可用时静默退回文本比对。
const crypto = require('crypto');
const db = require('./db');

const config = () => ({
  url: String(process.env.ASH_EMBED_URL || '').replace(/\/+$/, ''),
  model: process.env.ASH_EMBED_MODEL || 'bge-m3',
  key: process.env.ASH_EMBED_KEY || '',
  timeout: Number(process.env.ASH_EMBED_TIMEOUT_MS) || 15000,
  queryTimeout: Number(process.env.ASH_EMBED_QUERY_TIMEOUT_MS) || 8000,
});
const enabled = () => Boolean(config().url);
const BATCH = 4;
const PER_TEXT_MS = 30000;   // 后台补齐时每条文本最多给这么久（慢 CPU 上一条要好几秒）

let lastError = null;
let lastErrorLogged = 0;
function noteError(err) {
  lastError = err.message;
  // 模型服务挂了时每个请求都会失败：日志每分钟最多一条
  if (Date.now() - lastErrorLogged > 60000) { console.error('embeddings:', err.message); lastErrorLogged = Date.now(); }
}

const textHash = (text) => crypto.createHash('sha256').update(`${config().model}\0${text}`).digest('hex').slice(0, 16);

function normalize(values) {
  const vec = Float32Array.from(values);
  let norm = 0;
  for (const x of vec) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vec.length; i += 1) vec[i] /= norm;
  return vec;
}

// 两个单位向量的余弦
function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

async function embed(texts, timeout = config().timeout) {
  const { url, model, key } = config();
  const openai = /\/v1$/.test(url);
  const res = await fetch(openai ? `${url}/embeddings` : `${url}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`向量接口返回 ${res.status}：${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const vectors = openai ? (body.data || []).map((d) => d.embedding) : body.embeddings;
  if (!Array.isArray(vectors) || vectors.length !== texts.length) throw new Error('向量接口返回的数量不对');
  return vectors.map(normalize);
}

const toBlob = (vec) => Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
// Buffer 的偏移不一定是 4 的倍数，先拷贝再按 Float32 解读
const fromBlob = (buf) => new Float32Array(Uint8Array.from(buf).buffer);

// 库里已有的向量：Map(skillId → Float32Array)，只要文本没变过的（docs 来自相关度索引，带 embedText）
function vectorsFor(docs) {
  if (!enabled() || !docs.length) return new Map();
  const wanted = new Map(docs.map((d) => [d.skill.id, textHash(d.embedText)]));
  const rows = db.prepare(`SELECT skill_id, text_hash, vector FROM skill_embeddings WHERE skill_id IN (${docs.map(() => '?').join(',')})`)
    .all(...docs.map((d) => d.skill.id));
  const vectors = new Map();
  for (const row of rows) if (wanted.get(row.skill_id) === row.text_hash) vectors.set(row.skill_id, fromBlob(row.vector));
  return vectors;
}

// 补齐缺的向量。同一个库同时只跑一次；返回是否全部就绪。
// 正在跑的那一轮可能是按更早的技能列表开始的（例如刚推送的新技能不在里面）：等它结束后再按当前列表查一遍
const inflight = new Map();
function ensureVectors(userId, docs) {
  if (!enabled()) return Promise.resolve(false);
  if (inflight.has(userId)) return inflight.get(userId).then(() => ensureVectors(userId, docs));
  const run = (async () => {
    // 先让出一次：否则没有缺的向量时整个函数同步跑完，finally 会在下面 inflight.set 之前执行，
    // 留下一个永远不清除的已完成标记，后来的调用会无限地「等它结束再查一遍」
    await null;
    const have = vectorsFor(docs);
    // 新技能优先：刚推送的技能要先有向量，才能参与查重
    const missing = docs.filter((d) => !have.has(d.skill.id)).sort((a, b) => b.skill.id - a.skill.id);
    const upsert = db.prepare(`
      INSERT INTO skill_embeddings (skill_id, text_hash, vector, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(skill_id) DO UPDATE SET text_hash = excluded.text_hash, vector = excluded.vector, updated_at = CURRENT_TIMESTAMP
    `);
    try {
      for (let i = 0; i < missing.length; i += BATCH) {
        const batch = missing.slice(i, i + BATCH);
        const vectors = await embed(batch.map((d) => d.embedText), Math.max(config().timeout, PER_TEXT_MS * batch.length));
        db.transaction(() => batch.forEach((d, j) => {
          // 算向量期间技能可能被删了：外键约束会拒绝写入，跳过即可
          try { upsert.run(d.skill.id, textHash(d.embedText), toBlob(vectors[j])); } catch { /* 已删除 */ }
        }))();
      }
      lastError = null;
      return true;
    } catch (err) {
      noteError(err);
      return false;
    } finally {
      inflight.delete(userId);
    }
  })();
  inflight.set(userId, run);
  return run;
}

// 等向量补齐，但最多等 ms 毫秒（推送时要让新技能也参与查重，又不能让推送卡在模型上）
async function ensureVectorsWithin(userId, docs, ms = 5000) {
  if (!enabled()) return false;
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), ms); });
  const done = await Promise.race([ensureVectors(userId, docs), timeout]);
  clearTimeout(timer);
  return done;
}

// 查询向量：同一句任务描述短时间内常被反复查，留一个小缓存
const queryCache = new Map();
async function embedQuery(text) {
  if (!enabled()) return null;
  const key = textHash(text);
  if (queryCache.has(key)) return queryCache.get(key);
  try {
    const [vec] = await embed([text], config().queryTimeout);
    queryCache.set(key, vec);
    if (queryCache.size > 200) queryCache.delete(queryCache.keys().next().value);
    return vec;
  } catch (err) {
    noteError(err);
    return null;
  }
}

const status = () => ({ enabled: enabled(), model: enabled() ? config().model : null, last_error: lastError });

module.exports = { enabled, embed, vectorsFor, ensureVectors, ensureVectorsWithin, embedQuery, cosine, status };
