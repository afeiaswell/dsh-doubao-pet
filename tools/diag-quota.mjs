/**
 * 诊断 v2：用真实鼠标点击设置里的菜单，逐个试「加强套餐」「订阅与额度管理」，
 * 看哪个页面会出现额度数字；把每次的截图和文本都存下来。
 *   node tools/diag-quota.mjs
 */
import { writeFileSync } from 'node:fs';

const PORT = 9222;
const OUT = 'art/ai/doubao_plugin';

function session(wsUrl, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let seq = 0;
    const api = {
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const id = ++seq;
          pending.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, params }));
          setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(method + ' timeout')); } }, timeoutMs);
        });
      },
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
      }
    });
  });
}

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const main = list.find((t) => /doubao-chat/i.test(t.url)) || list.find((t) => t.type === 'page');
if (!main) { console.log('no page'); process.exit(1); }
const s = await session(main.webSocketDebuggerUrl);

const evalJs = async (expr) => {
  const r = await s.send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true });
  return r && r.result ? r.result.value : null;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function realClickText(label) {
  const box = await evalJs(`(() => {
    const el = [...document.querySelectorAll('div,span,button')]
      .filter((e) => (e.textContent || '').trim() === ${JSON.stringify(label)})
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, w: Math.round(r.width) });
  })()`);
  if (!box) return `not-found:${label}`;
  const p = JSON.parse(box);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await s.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
  }
  return `clicked:${label}@${Math.round(p.x)},${Math.round(p.y)}`;
}

async function waitForNumber(maxMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const ok = await evalJs(`(() => {
      const t = document.body ? document.body.innerText : '';
      return /\\d{1,7}\\s*[\\/／]\\s*\\d{2,8}/.test(t) ? 'yes' : 'no';
    })()`);
    if (ok === 'yes') return Date.now() - t0;
    await sleep(700);
  }
  return -1;
}

async function snapshot(tag) {
  const text = await evalJs('document.body ? document.body.innerText : ""');
  const shot = await s.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/_quota_${tag}.png`, Buffer.from(shot.data, 'base64'));
  writeFileSync(`${OUT}/_quota_${tag}.txt`, String(text), 'utf8');
  return String(text);
}

console.log('open settings:', await evalJs(`(() => { const b = document.querySelector('[data-testid="sidebar_footer_setting_entry"]'); if(!b) return 'no'; b.click(); return 'ok'; })()`));
await sleep(1000);

const report = {};
for (const label of ['加强套餐', '订阅与额度管理']) {
  report[label] = {};
  report[label].click = await realClickText(label);
  report[label].waitedMs = await waitForNumber(8000);
  const text = await snapshot(label === '加强套餐' ? 'upgrade' : 'quota');
  // 抓所有含 / 或「额度/次数/用量/剩余」的片段
  report[label].snippets = await evalJs(`(() => {
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const t = (el.textContent || '').trim();
      if (!t || t.length > 60) continue;
      if (el.children.length === 0 && /(\\d|额度|用量|剩余|次数)/.test(t)) out.push(t);
    }
    return JSON.stringify([...new Set(out)].slice(0, 60));
  })()`);
  report[label].tail = String(text).slice(-700);
  console.log(`--- ${label} ---`);
  console.log(report[label].click, 'wait=', report[label].waitedMs, 'ms');
  console.log(report[label].snippets);
}

writeFileSync(`${OUT}/_quota_report.json`, JSON.stringify(report, null, 2), 'utf8');
console.log('报告 → art/ai/doubao_plugin/_quota_report.json');

for (let i = 0; i < 2; i++) {
  await s.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(300);
}
s.close();
setTimeout(() => process.exit(0), 200);
