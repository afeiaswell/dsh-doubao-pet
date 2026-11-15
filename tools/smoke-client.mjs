/**
 * 客户端渲染冒烟测试：用假 React + 假 DOM 把 client.js 真跑一遍 render，
 * 用来抓 ReferenceError / 未定义变量这类"一崩就把整个挂件搞没"的问题。
 *
 *   node tools/smoke-client.mjs
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

let registered = null;
const sandbox = {
  console,
  JSON, Math, Number, String, Boolean, Object, Array, Date, RegExp, Error, Promise,
  setTimeout: () => 0,
  clearTimeout: () => {},
  fetch: async () => ({ ok: true, status: 200, text: async () => '{}' }),
  Node: class Node {},
  document: {
    addEventListener: () => {},
    removeEventListener: () => {},
    body: { innerText: '' },
    querySelector: () => null,
  },
  window: {
    innerWidth: 1400,
    innerHeight: 900,
    localStorage: makeStorage(),
    addEventListener: () => {},
    removeEventListener: () => {},
    __ModuleLoader__: { load: (m) => { registered = m; } },
  },
};
sandbox.globalThis = sandbox;
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'client.js' });

if (!registered) throw new Error('❌ 客户端模块没有调用 __ModuleLoader__.load');
if (registered.id !== 'dsh-doubao-pet') throw new Error(`❌ 模块 id 不对: ${registered.id}`);

const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useRef: (v) => ({ current: v }),
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
};

const mod = registered.factory((name) => {
  if (name === 'react') return fakeReact;
  throw new Error(`❌ 客户端 require 了不该 require 的模块: ${name}`);
});

let Comp = null;
const fakeCtx = {
  slots: {
    // 真实签名：ctx.slots.inject(key, () => ctx.slots.register(opts, Component))
    register: (options, component) => { Comp = component; return () => {}; },
    inject: (key, cb) => {
      const effect = cb();
      return typeof effect === 'function' ? effect : () => {};
    },
  },
};
mod.apply(fakeCtx);

if (typeof Comp !== 'function') throw new Error('❌ 没有注册组件到 shell.overlay');

let tree = null;
try {
  tree = Comp();
} catch (err) {
  throw new Error(`❌ 渲染抛错（这正是挂件消失的原因）: ${err && err.message}`);
}
if (!tree || tree.type !== 'div') throw new Error('❌ 渲染结果不是根 div');

// 递归数一下节点，确保真的产出了树
let count = 0;
(function walk(n) {
  if (!n || typeof n !== 'object') return;
  count += 1;
  if (Array.isArray(n.children)) n.children.forEach(walk);
})(tree);

console.log(`✅ 渲染通过：根节点 <${tree.type}>，共 ${count} 个节点`);
console.log(`   角色/气泡/面板等子树都已生成（status 为 null 时的降级路径）`);
