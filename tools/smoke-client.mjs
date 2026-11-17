/**
 * 客户端渲染冒烟测试：用假 React + 假 DOM 把 client.js 真跑一遍 render，
 * 用来抓 ReferenceError / 未定义变量这类"一崩就把整个挂件搞没"的问题。
 *
 * 额外校验两件事（都是回归过的真 bug）：
 *   1. 位置/大小必须写进 localStorage —— 组件内曾有个同名 savePrefs 遮蔽了它，
 *      导致刷新后位置丢失；
 *   2. 立绘外面要有 .dbpet-art 包裹层 —— 水平镜像挂在它身上，不能翻齿轮和手柄。
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
    __dump: () => Object.fromEntries(map),
  };
}

let registered = null;
const storage = makeStorage();
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
    localStorage: storage,
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

// 收集整棵树，检查结构
const nodes = [];
(function walk(n) {
  if (!n || typeof n !== 'object') return;
  nodes.push(n);
  if (Array.isArray(n.children)) n.children.forEach(walk);
})(tree);

const cls = (n) => (n.props && typeof n.props.className === 'string' ? n.props.className : '');

// 校验 1：立绘外层必须有 .dbpet-art
const art = nodes.find((n) => cls(n).startsWith('dbpet-art'));
if (!art) throw new Error('❌ 找不到 .dbpet-art 包裹层（水平镜像无处可挂）');
if (!art.children.some((c) => c && c.type === 'img')) throw new Error('❌ .dbpet-art 里没有 img');

// 校验 2：模块级 savePrefs 必须写 localStorage（而不是被组件内同名函数遮蔽）
const saveMatch = src.match(/function savePrefs\(patch\)\s*\{[\s\S]{0,400}?\}/);
if (!saveMatch) throw new Error('❌ 找不到模块级 savePrefs');
if (!/localStorage\.setItem/.test(saveMatch[0])) throw new Error('❌ 模块级 savePrefs 没有写 localStorage');

// 校验 3：组件内不得再声明同名 savePrefs（遮蔽会让位置/大小存不进去）
if (/const savePrefs\s*=/.test(src)) throw new Error('❌ 组件内又出现了 savePrefs 同名函数（会遮蔽 localStorage 版本）');

// 校验 4：初始位置必须是同步还原（useState 初始化），不能是 null 再靠 effect 补
if (!/const \[pos, setPos\] = useState\(\(\) =>/.test(src)) throw new Error('❌ 初始位置不是同步还原（刷新会闪一下）');

console.log(`✅ 渲染通过：根节点 <${tree.type}>，共 ${nodes.length} 个节点`);
console.log('✅ 持久化链路：模块级 savePrefs 未被遮蔽，初始位置同步还原');
console.log('✅ 镜像结构：.dbpet-art 包裹层存在（只翻立绘，不翻按钮）');
