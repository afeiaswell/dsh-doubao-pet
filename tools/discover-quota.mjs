/**
 * 一次性侦查：抓出豆包客户端「额度」数据到底来自哪个接口。
 * 做法：CDP 开 Network 监听 → 程序化打开 设置 → 订阅与额度管理 →
 * 收集所有 XHR/Fetch 请求，挑出疑似额度的，并把响应体抓下来。
 *
 *   node tools/discover-quota.mjs
 *
 * 抓到端点后就不需要再开界面了：以后直接在页面上下文里 fetch 即可（静默）。
 */
import { writeFileSync } from 'node:fs';

const PORT = 9222;
const OUT = 'art/ai/doubao_plugin/_quota_discovery.json';
const KEYWORDS = /(subscription|quota|balance|benefit|right|plan|usage|limit|credit|package|pay|order|member|vip|privilege)/i;

function session(wsUrl, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const listeners = [];
    let seq = 0;
    const api = {
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const id = ++seq;
          pending.set(id, { res, rej });
          try { ws.send(JSON.stringify({ id, method, params })); } catch (e) { pending.delete(id); rej(e); return; }
          setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(method + ' timeout')); } }, timeoutMs);
        });
      },
      on(fn) { listeners.push(fn); },
      close() { try { ws.close(); } catch { /* ignore */ } },
    };
    ws.addEventListener('open', () => resolve(api));
    ws.addEventListener('error', () => reject(new Error('ws error')));
    ws.addEventListener('message', (ev) => {
      let m = null;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) rej(new Error(m.error.message)); else res(m.result);
        return;
      }
      if (m.method) listeners.forEach((fn) => fn(m));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => /doubao-chat/i.test(t.url)) || list.find((t) => t.type === 'page');
if (!page) { console.log('找不到页面'); process.exit(1); }

const s = await session(page.webSocketDebuggerUrl);
const reqs = new Map();     // requestId -> {url, method, type}
const responses = [];       // {url, status, mime}

s.on((m) => {
  if (m.method === 'Network.requestWillBeSent') {
    const r = m.params.request;
    reqs.set(m.params.requestId, { url: r.url, method: r.method, type: m.params.type });
  }
  if (m.method === 'Network.responseReceived') {
    responses.push({ id: m.params.requestId, url: m.params.response.url, status: m.params.response.status, mime: m.params.response.mimeType });
  }
});

await s.send('Network.enable');
await s.send('Runtime.enable');

const evalJs = async (expr) => {
  const r = await s.send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true, awaitPromise: true });
  return r && r.result ? r.result.value : null;
};

// 先看本地存储里有没有现成的套餐快照
const storage = await evalJs(`(() => {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = String(localStorage.getItem(k));
      if (/(quota|subscri|balance|plan|vip|member|benefit)/i.test(k + v)) out['ls:' + k] = v.slice(0, 800);
    }
  } catch (e) {}
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      const v = String(sessionStorage.getItem(k));
      if (/(quota|subscri|balance|plan|vip|member|benefit)/i.test(k + v)) out['ss:' + k] = v.slice(0, 800);
    }
  } catch (e) {}
  return JSON.stringify(out);
})()`);

console.log('打开设置…');
await evalJs(`(() => { const b = document.querySelector('[data-testid="sidebar_footer_setting_entry"]'); if (b) b.click(); return 'ok'; })()`);
await sleep(1200);
console.log('点订阅与额度管理…');
await evalJs(`(() => {
  const el = [...document.querySelectorAll('div,span,button')]
    .filter((e) => (e.textContent || '').trim() === '订阅与额度管理')
    .filter((e) => e.getBoundingClientRect().width > 0)
    .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
  if (!el) return 'no-item';
  (el.closest('[role="button"],button') || el).click();
  return 'ok';
})()`);
await sleep(6000);

// 再点一次「加强套餐」，套餐页通常也会拉额度接口
await evalJs(`(() => {
  const el = [...document.querySelectorAll('div,span,button')]
    .filter((e) => (e.textContent || '').trim() === '加强套餐')
    .filter((e) => e.getBoundingClientRect().width > 0)[0];
  if (el) (el.closest('[role="button"],button') || el).click();
  return 'ok';
})()`);
await sleep(4000);

// 收集可疑请求 + 抓响应体
const interesting = [];
for (const [id, r] of reqs) {
  if (!KEYWORDS.test(r.url)) continue;
  interesting.push({ id, url: r.url, method: r.method, type: r.type });
}
const bodies = [];
for (const item of interesting.slice(0, 25)) {
  try {
    const b = await s.send('Network.getResponseBody', { requestId: item.id });
    const text = b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body;
    bodies.push({ url: item.url, body: text.slice(0, 1500) });
  } catch (e) {
    bodies.push({ url: item.url, error: String(e.message).slice(0, 80) });
  }
}

// 关掉设置
for (let i = 0; i < 2; i++) {
  await s.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(250);
}
s.close();

const report = {
  storage: JSON.parse(storage || '{}'),
  totalRequests: reqs.size,
  interesting,
  bodies,
};
writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
console.log(`共捕获 ${reqs.size} 个请求，可疑 ${interesting.length} 个 → ${OUT}`);
for (const it of interesting.slice(0, 20)) console.log('  ', it.method, it.url.slice(0, 150));
setTimeout(() => process.exit(0), 200);
