/**
 * 火山方舟（Doubao Seedream）最小客户端：网关嗅探 + 模型可达性探测 + 生图。
 *
 * 两条血泪规则（沿用 workspace 里 imgforge 的结论）：
 *  1) 网关必须和 key 配对。套餐（Agent Plan）的 key 要用 /api/plan/v3，
 *     按量的 key 用 /api/v3；配错一律 401，且空 body 探测区分不出来，
 *     必须带真参数（401 才是"这网关不对"的铁证）。
 *  2) 模型 id 必须带日期后缀，裸名一律 404。
 */

const PLAN_BASE = 'https://ark.cn-beijing.volces.com/api/plan/v3';
const PAYG_BASE = 'https://ark.cn-beijing.volces.com/api/v3';

/** 已知的 ImageGeneration 模型（2026-11 快照，用于没有 /models 接口时兜底） */
const KNOWN_IMAGE_MODELS = [
  'doubao-seedream-5-0-flash-260915',
  'doubao-seedream-5-0-pro-260628',
  'doubao-seedream-5-5-261028',
  'doubao-seedream-4-5-251128',
  'doubao-seedream-4-0-250828',
  'doubao-seedream-5-0-260128',
];

const DEFAULT_MODEL = 'doubao-seedream-5-0-flash-260915';

function billingModeOf(base) {
  return /\/api\/plan\//i.test(String(base)) ? 'plan' : 'payg';
}

async function fetchJson(url, init, timeoutMs = 30000) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, ok: res.ok, json, text };
}

function apiError(json, text) {
  const e = json && json.error;
  return {
    code: (e && e.code) || '',
    message: (e && e.message) || String(text || '').slice(0, 240),
  };
}

/**
 * 只给一把 key，判断它属于哪个数据面。
 * 用带真参数的请求：正确网关回 400 InvalidParameter 或 404 UnsupportedModel，
 * 错误网关回 401 AuthenticationError。全程不出图、不计费。
 */
export async function detectGateway(apiKey) {
  const results = [];
  const body = JSON.stringify({
    model: DEFAULT_MODEL, prompt: 'probe', size: '99999x99999', response_format: 'url',
  });
  for (const base of [PLAN_BASE, PAYG_BASE]) {
    try {
      const r = await fetchJson(`${base}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body,
      });
      const wrong = r.status === 401 || r.status === 403;
      results.push({ base, mode: billingModeOf(base), status: r.status, usable: !wrong && r.status > 0, error: wrong ? apiError(r.json, r.text) : null });
    } catch (err) {
      results.push({ base, mode: billingModeOf(base), status: 0, usable: false, error: { code: '', message: String(err && err.message || err) } });
    }
  }
  return results;
}

/** 空 body 只能证明"key 存在"，不能证明网关对；这里只用来给 401 排错时补充线索 */
export async function keyExists(apiKey) {
  try {
    const r = await fetchJson(`${PLAN_BASE}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: '{}',
    });
    return { status: r.status, ok: r.status === 400 };
  } catch {
    return { status: 0, ok: false };
  }
}

/** 拉模型清单：优先问 /models，端点不存在时回退内置表 */
export async function listModels(apiKey, base) {
  const known = new Set(KNOWN_IMAGE_MODELS);
  let listed = [];
  try {
    const r = await fetchJson(`${base}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (r.ok && r.json && Array.isArray(r.json.data)) {
      listed = r.json.data
        .filter((m) => /ImageGeneration/i.test(m.domain || '') || (m.api_supported && m.api_supported['images/generations']))
        .map((m) => m.id || m.name)
        .filter(Boolean);
      for (const id of listed) known.add(id);
    }
  } catch { /* 忽略，用内置表 */ }
  return { listed, candidates: [...known] };
}

/**
 * 逐个模型做免费可达性探测。
 * 400 InvalidParameter → 可达；404 → 不在套餐/未开通；401 → 网关不配对；429 → 额度。
 */
export async function probeModels(apiKey, base, candidates) {
  const out = [];
  for (const id of candidates) {
    let entry = { id, reachable: false, status: 0, state: 'unknown', detail: '' };
    try {
      const r = await fetchJson(`${base}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: id, prompt: 'probe', size: '99999x99999', response_format: 'url' }),
      }, 20000);
      const err = apiError(r.json, r.text);
      entry.status = r.status;
      entry.detail = err.message.slice(0, 160);
      if (r.ok) { entry.reachable = true; entry.state = 'ok'; }
      else if (r.status === 400 && /InvalidParameter/i.test(r.text || '')) { entry.reachable = true; entry.state = 'reachable'; }
      else if (r.status === 404) entry.state = 'absent';
      else if (r.status === 401) entry.state = 'unauthenticated';
      else if (r.status === 429) entry.state = 'quota';
      else entry.state = 'error';
    } catch (err) {
      entry.state = 'network';
      entry.detail = String(err && err.message || err).slice(0, 160);
    }
    out.push(entry);
  }
  return out;
}

function detectExt(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.length > 12 && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return 'bin';
}

/**
 * 真出一张图：一次请求一张（seedream-5-0 不支持 sequential 批量参数），
 * 返回落盘后的文件路径。
 */
export async function generateImage({ apiKey, base, model, prompt, size = '2K', count = 1, outDir, fileBase = 'doubao' }) {
  const { writeFile, mkdir } = await import('node:fs/promises');
  const path = await import('node:path');
  await mkdir(outDir, { recursive: true });
  const files = [];
  const errors = [];
  const n = Math.max(1, Math.min(4, Number(count) || 1));
  for (let k = 0; k < n; k++) {
    const r = await fetchJson(`${base}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, prompt, size, response_format: 'url', watermark: false }),
    }, 300000);
    if (!r.ok) {
      errors.push(apiError(r.json, r.text));
      break;
    }
    const data = (r.json && Array.isArray(r.json.data)) ? r.json.data : [];
    for (let i = 0; i < data.length; i++) {
      const url = data[i] && data[i].url;
      if (!url) { errors.push({ code: '', message: '响应里没有图片 url（可能审核未通过）' }); continue; }
      try {
        const img = await fetch(url, { signal: AbortSignal.timeout(120000) });
        const buf = Buffer.from(await img.arrayBuffer());
        const ext = detectExt(buf);
        const name = `${fileBase}_${Date.now()}_${k}${data.length > 1 ? `_${i}` : ''}.${ext}`;
        const fp = path.join(outDir, name);
        await writeFile(fp, buf);
        files.push({ path: fp, name, bytes: buf.length, model, size });
      } catch (err) {
        errors.push({ code: '', message: `下载失败: ${String(err && err.message || err)}` });
      }
    }
  }
  return { files, errors, model, size };
}

export { PLAN_BASE, PAYG_BASE, KNOWN_IMAGE_MODELS, DEFAULT_MODEL, billingModeOf };
