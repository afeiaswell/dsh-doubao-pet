/**
 * 离线验证路由鉴权：不启动 DSH，直接在 Node 里 apply() 插件，
 * 用假 req/res 调它注册的 handler，确认 token 闸门生效。
 *
 *   node tools/test-route-auth.mjs
 */
import { fileURLToPath, pathToFileURL } from 'node:url';

// 路径含中文，必须用 fileURLToPath 解码，不能手工切 pathname
const indexPath = fileURLToPath(new URL('../index.js', import.meta.url));
const mod = await import(pathToFileURL(indexPath).href);

let handler = null;
let tapIndex = null;
const tools = [];

const fakeCtx = {
  logger: { info: () => {}, warn: (m) => console.log('  [warn]', m) },
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {}; },
  get: () => undefined,
  webServer: {
    register: (route) => { handler = route.handler; return () => {}; },
    tapIndex: (fn) => { tapIndex = fn; return () => {}; },
  },
  tools: { register: (t) => { tools.push(t); return () => {}; } },
  credentials: {
    resolve: async () => null,
    set: async () => {},
    unset: async () => {},
  },
};

mod.apply(fakeCtx, {});
if (!handler) throw new Error('❌ 没注册路由');
if (!tapIndex) throw new Error('❌ 没注册 tapIndex（token 无法下发）');

// 1) 从注入结果里取 token
const html = tapIndex('<html><head><title>x</title></head><body></body></html>');
const m = html.match(/<meta name="dsh-doubao-pet-token" content="([0-9a-f]+)">/);
if (!m) throw new Error('❌ index.html 里没注入 token meta');
const TOKEN = m[1];
console.log(`✅ token 已注入 index.html（${TOKEN.length} 字符）`);

function call({ method = 'GET', url, headers = {} }) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 0,
      body: '',
      writeHead(code) { this.statusCode = code; },
      end(body) { this.body = body || ''; resolve({ status: this.statusCode, body: this.body }); },
    };
    handler({ method, url, headers: { host: '127.0.0.1:3080', ...headers } }, res);
  });
}

const cases = [
  { name: '无 token 调 API', req: { url: '/doubao-pet/api/status' }, expect: 401 },
  { name: '错误 token 调 API', req: { url: '/doubao-pet/api/status', headers: { 'x-doubao-pet-token': 'deadbeef' } }, expect: 401 },
  { name: '无 token 取素材图', req: { url: '/doubao-pet/asset/doubao.png' }, expect: 401 },
  { name: '正确 token（header）', req: { url: '/doubao-pet/api/status', headers: { 'x-doubao-pet-token': TOKEN } }, expect: 200 },
  { name: '正确 token（?t= 取图）', req: { url: `/doubao-pet/asset/doubao.png?t=${TOKEN}` }, expect: 200 },
  { name: '正确 token 但跨站 Origin 的 POST', req: { method: 'POST', url: '/doubao-pet/api/prefs', headers: { 'x-doubao-pet-token': TOKEN, origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' }, expect: 403 },
];

let failed = 0;
for (const c of cases) {
  const r = await call(c.req);
  const ok = r.status === c.expect;
  if (!ok) failed += 1;
  console.log(`  ${ok ? '✅' : '❌'} ${c.name}: HTTP ${r.status}（期望 ${c.expect}）`);
}

// 工具仍然可直调（不经过 HTTP）
console.log(`  ✅ 注册的工具: ${tools.map((t) => t.name).join(', ')}`);
if (!tools.some((t) => t.name === 'doubao_generate_image')) failed += 1;

if (failed) throw new Error(`❌ ${failed} 项不符合预期`);
console.log('\n✅ 全部通过：非 DSH 界面调用一律 401，带 token 才放行，跨站 POST 另外被 403');
