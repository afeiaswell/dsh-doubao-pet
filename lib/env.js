/**
 * 本机环境探测：Ark CLI 装没装、豆包客户端装没装 / 跑没跑，以及一键部署 Ark CLI。
 * 全部只读探测，唯一有副作用的动作是 deployArkcli()，由界面显式确认后触发。
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DOUBAO_EXE_CANDIDATES = [
  'D:\\Doubao\\app\\Doubao.exe',
  'D:\\Doubao\\Doubao.exe',
  'C:\\Program Files\\Doubao\\Doubao.exe',
  'C:\\Program Files (x86)\\Doubao\\Doubao.exe',
];

function run(cmd, args, timeoutMs = 15000, shell = false) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: timeoutMs, shell, windowsHide: true }, (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err && typeof err.code === 'number' ? err.code : (err ? -1 : 0),
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          error: err ? String(err.message || err) : '',
        });
      });
    } catch (err) {
      resolve({ ok: false, code: -1, stdout: '', stderr: '', error: String(err && err.message || err) });
    }
  });
}

/** Ark CLI 是否可用，顺带记版本号 */
export async function probeArkcli() {
  const r = await run('arkcli', ['--version'], 12000, true);
  if (!r.ok) {
    return { installed: false, version: null, detail: (r.stdout + r.stderr || r.error).trim().slice(0, 200) };
  }
  const text = r.stdout.trim() || r.stderr.trim();
  const m = text.match(/(\d+\.\d+\.\d+)/);
  return { installed: true, version: m ? m[1] : text.slice(0, 40), detail: text.slice(0, 200) };
}

/** 豆包客户端：装在哪、有没有在跑 */
export async function probeDoubao() {
  const fromEnv = process.env.DOUBAO_EXE || '';
  const candidates = [...(fromEnv ? [fromEnv] : []), ...DOUBAO_EXE_CANDIDATES,
    path.join(process.env.LOCALAPPDATA || '', 'Doubao', 'Doubao.exe')].filter(Boolean);
  const exe = candidates.find((p) => { try { return existsSync(p); } catch { return false; } }) || null;

  // 注意：这里**不能**用 shell 执行。execFile + shell:true 会把参数直接拼成字符串，
  // `tasklist /FI "IMAGENAME eq Doubao.exe"` 的引号丢失，tasklist 报 "Invalid argument/option - 'eq'"，
  // 于是永远判定"未运行"。数组参数 + shell:false 才会被 Node 正确加引号。
  let running = false;
  const r = await run('tasklist', ['/FI', 'IMAGENAME eq Doubao.exe', '/FO', 'CSV', '/NH'], 15000, false);
  if (r.ok) {
    running = /Doubao\.exe/i.test(r.stdout);
  } else {
    // tasklist 不可用时的兜底
    const ps = await run('powershell', ['-NoProfile', '-Command', '(Get-Process Doubao -ErrorAction SilentlyContinue | Measure-Object).Count'], 15000, false);
    running = ps.ok && Number(String(ps.stdout).trim()) > 0;
  }

  return { installed: Boolean(exe), exe, running, downloadUrl: 'https://www.doubao.com/download' };
}

/**
 * 一键部署 Ark CLI（npm 全局安装）。这是唯一会改动本机的动作，界面需二次确认后再调用。
 * @param {(line: string) => void} [onLine] 进度回调（可选）
 */
export async function deployArkcli(onLine) {  const before = await probeArkcli();
  if (before.installed) {
    return { ok: true, alreadyInstalled: true, version: before.version, log: '已安装，跳过部署' };
  }
  const log = [];
  const push = (s) => { log.push(s); if (typeof onLine === 'function') onLine(s); };

  // Windows 下 npm 是 .cmd，必须经 shell 才能执行
  const r = await run('npm', ['install', '-g', '@volcengine/ark-cli@latest'], 300000, true);
  push(r.stdout.trim());
  if (r.stderr.trim()) push(r.stderr.trim());
  if (!r.ok) push(r.error);

  const after = await probeArkcli();
  return {
    ok: after.installed,
    alreadyInstalled: false,
    version: after.version,
    log: log.filter(Boolean).join('\n').slice(-4000),
    detail: after.installed ? '' : (r.error || '安装后仍检测不到 arkcli'),
  };
}

/**
 * 用 Ark CLI 查订阅套餐的**额度用量**（不是套餐档位）。
 * `arkcli usage plan` 返回的 periods 就是控制台那三行：5h / weekly / monthly。
 * 有些时段只有 percent 没有 used，这里按 total*percent 反算。
 */
export async function probePlanUsage() {
  const cli = await probeArkcli();
  if (!cli.installed) return { available: false, reason: 'arkcli 未安装' };

  const r = await run('arkcli', ['usage', 'plan'], 30000, true);
  if (!r.ok) {
    return {
      available: false,
      reason: 'arkcli 未登录或查询失败（需要先 `arkcli auth login`）',
      detail: (r.stdout + r.stderr || r.error).trim().slice(0, 300),
    };
  }
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* 非 JSON */ }
  if (!parsed || !Array.isArray(parsed.items)) {
    return { available: false, reason: 'Ark CLI 返回内容无法解析', detail: String(r.stdout).slice(0, 300) };
  }

  const items = parsed.items.map((it) => ({
    product: it.product || '',
    edition: it.edition || '',
    tier: it.tier || '',
    subscribed: Boolean(it.subscribed),
    periods: (it.periods || []).map((p) => {
      const total = Number(p.total || 0);
      const used = p.used != null ? Number(p.used) : Math.round(total * Number(p.percent || 0) / 100);
      return {
        label: p.label || '',
        used,
        total,
        percent: p.percent != null ? Number(p.percent) : (total ? Math.round((used / total) * 10000) / 100 : 0),
        resetAt: p.reset_at || null,
      };
    }),
  }));
  return { available: true, viewer: parsed.viewer || null, items };
}

/** 极简 CDP 会话：给一个 send，用完关掉 */
function cdpSession(wsUrl, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocket(wsUrl); } catch (e) { reject(e); return; }
    const pending = new Map();
    let seq = 0;
    const guard = setTimeout(() => { try { ws.close(); } catch { /* ignore */ } reject(new Error('CDP 超时')); }, timeoutMs);
    const api = {
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const id = ++seq;
          pending.set(id, { res, rej });
          try { ws.send(JSON.stringify({ id, method, params })); } catch (e) { pending.delete(id); rej(e); return; }
          setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(`CDP ${method} 超时`)); } }, timeoutMs);
        });
      },
      close() { clearTimeout(guard); try { ws.close(); } catch { /* ignore */ } },
    };
    ws.addEventListener('open', () => resolve(api));
    ws.addEventListener('error', () => { clearTimeout(guard); reject(new Error('CDP 连接失败')); });
    ws.addEventListener('message', (ev) => {
      let m = null;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) rej(new Error(m.error.message)); else res(m.result);
      }
    });
  });
}

// 额度数字：347/24000、0 / 10000 这类。除了页面文本，也翻一遍 localStorage / sessionStorage
// （客户端常把套餐快照塞在本地存储里，这条路不弹窗、不闪界面）。
const QUOTA_HITS = `(() => {
  const texts = [document.body ? document.body.innerText : ''];
  try {
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); texts.push(k + '=' + String(localStorage.getItem(k))); }
  } catch (e) {}
  try {
    for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); texts.push(k + '=' + String(sessionStorage.getItem(k))); }
  } catch (e) {}
  const re = /(\\d{1,7})\\s*[\\/／]\\s*(\\d{2,8})/g;
  const seen = [];
  for (const text of texts) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const used = Number(m[1]); const total = Number(m[2]);
      if (total >= 1000 && used >= 0 && used <= total) seen.push({ used, total });
    }
  }
  return JSON.stringify(seen.slice(0, 20));
})()`;

async function scrapeTarget(wsUrl, timeoutMs = 1800) {
  const s = await cdpSession(wsUrl, timeoutMs);
  try {
    const r = await s.send('Runtime.evaluate', { expression: QUOTA_HITS, returnByValue: true });
    const v = r && r.result ? r.result.value : null;
    return v ? JSON.parse(v) : [];
  } finally { s.close(); }
}

/** 列出客户端所有可求值的 target（页面 + iframe/webview 都在里面） */
export async function listCdpTargets(port = 9222) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const list = await res.json();
    return (Array.isArray(list) ? list : []).filter((t) => t.webSocketDebuggerUrl && !/devtools/i.test(`${t.url} ${t.title || ''}`));
  } catch { return null; }
}

/**
 * 读豆包客户端额度（347/24000 这类）——**纯静默**：
 * 只扫已在运行页面的 DOM、localStorage、sessionStorage，不点菜单、不弹设置、不闪窗口。
 *
 * 实测这版客户端把额度放在设置弹窗里（不进可读 DOM），所以大概率读不到；
 * 读不到就如实返回原因，由界面上的手动填写兜底。整段最多 ~1.8s。
 */
export async function probeDoubaoQuota(port = 9222) {
  const targets = await listCdpTargets(port);
  if (!targets) return { available: false, reason: '客户端没有开启调试端口' };
  if (!targets.length) return { available: false, reason: '客户端没有可读页面' };

  const pages = targets.filter((t) => t.type === 'page' && !/background/i.test(`${t.url} ${t.title || ''}`));
  const scan = (pages.length ? pages : targets).slice(0, 3);
  const batches = await Promise.all(scan.map(async (t) => {
    try { return await scrapeTarget(t.webSocketDebuggerUrl, 1800); } catch { return []; }
  }));
  const hits = batches.flat().sort((a, b) => b.total - a.total);
  const hit = hits[0];
  if (!hit) {
    return { available: false, reason: '客户端没有把额度放进可读的 DOM / 本地存储（可在下方手动填写）' };
  }
  return {
    available: true,
    used: hit.used,
    total: hit.total,
    percent: Math.round((hit.used / hit.total) * 10000) / 100,
    source: 'doubao-desktop/cdp',
  };
}

/**
 * 用 Ark CLI 查套餐档位（订阅信息，不含额度用量；额度见 probePlanUsage）。
 */
export async function probePlan() {
  const cli = await probeArkcli();
  if (!cli.installed) return { available: false, reason: 'arkcli 未安装' };

  const plans = await run('arkcli', ['plans', 'get'], 30000, true);
  if (!plans.ok) {
    return {
      available: false,
      reason: 'arkcli 未登录或查询失败（需要先 `arkcli auth login`）',
      detail: (plans.stdout + plans.stderr || plans.error).trim().slice(0, 300),
    };
  }
  let parsed = null;
  try { parsed = JSON.parse(plans.stdout); } catch { /* 可能不是 JSON */ }
  const list = (parsed && Array.isArray(parsed.plans)) ? parsed.plans : [];
  return {
    available: true,
    plans: list.map((p) => ({ key: p.key || '', name: p.name || '', tier: p.tier || '', scope: p.scope || '', status: p.status || '' })),
    raw: list.length ? '' : plans.stdout.trim().slice(0, 600),
  };
}
