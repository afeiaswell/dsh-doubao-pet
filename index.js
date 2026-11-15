/**
 * dsh-doubao-pet —— 宿主侧（Host half）
 *
 * 1) HTTP 路由 /doubao-pet/* ：角色素材、环境状态、资费统计、API Key 校验、模型探测、套餐查询。
 * 2) Agent 工具：doubao_pet_status / doubao_generate_image（生图只走接口，界面不再放生图表单）。
 * 3) API Key 存 credentials，不写配置文件。
 *
 * 生图用法文档：docs/IMAGE_GEN.md（工具描述里也指向它，DSH 需要图时先读文档再调用）。
 */

import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  detectGateway, keyExists, listModels, probeModels, generateImage,
  billingModeOf, DEFAULT_MODEL, KNOWN_IMAGE_MODELS, PLAN_BASE, PAYG_BASE,
} from './lib/ark.js';
import { probeArkcli, probeDoubao, deployArkcli, probePlan, probePlanUsage, probeDoubaoQuota, relaunchDoubaoWithDebug } from './lib/env.js';
const PKG_DIR = path.dirname(fileURLToPath(import.meta.url));
const CREDENTIAL_KEY = 'DOUBAO_ARK_API_KEY';
const PREFIX = '/doubao-pet';

/** 角色清单：素材全部来自工作区立绘（prepare-assets → trim-assets 处理后） */
const CHARACTERS = [
  {
    id: 'doubao', name: '豆包',
    assets: { idle: 'doubao.png', hover: 'doubao-smile.png', click: 'doubao-squint.png' },
  },
  {
    id: 'sdniang', name: 'sd娘',
    assets: { idle: 'sdniang.png', hover: 'sdniang-smile.png', click: 'sdniang-squint.png' },
  },
];

const ASSET_ALLOWLIST = new Set(CHARACTERS.flatMap((c) => Object.values(c.assets)));

/** 官方单价（元/张），用于气泡里的开销折算；key 为去掉日期后缀的模型名 */
const PRICE = {
  'doubao-seedream-5-0-flash': { flat: 0.12 },
  'doubao-seedream-5-0-pro': { '2K': 0.30, '4K': 0.60, flat: 0.30 },
  'doubao-seedream-5-5': { '2K': 0.13, '4K': 0.23, flat: 0.13 },
  'doubao-seedream-4-5': { flat: 0.25 },
  'doubao-seedream-4-0': { flat: 0.20 },
};

function unitPrice(model, size) {
  const key = String(model || '').replace(/-\d{6}$/, '');
  const row = PRICE[key];
  if (!row) return null;
  if (row[size] != null) return row[size];
  return row.flat != null ? row.flat : null;
}

/** 读 PNG 的 IHDR 取宽高（素材是 PNG，不需要额外依赖） */
function pngSize(buf) {
  if (buf.length < 24) return null;
  if (!(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const localDay = (d) => new Date(d).toLocaleDateString('sv-SE'); // YYYY-MM-DD（本地时区）

export const inject = ['tools', 'webServer', 'credentials'];

export function apply(ctx, config = {}) {
  // 宿主进程 cwd 是 DSH 安装目录、workingDirectory.defaultDirectory 也是安装目录，
  // 所以优先取「用户工作区登记表里最近更新的那个」，那才是用户真正在做的项目。
  const resolveOutDir = () => {
    if (config.outDir) return { dir: path.resolve(config.outDir), source: 'config.outDir', base: path.dirname(config.outDir) };
    let base = '';
    let source = '';
    try {
      const reg = ctx.get('workspaceRegistry');
      const list = reg && typeof reg.list === 'function' ? reg.list() : [];
      const usable = (Array.isArray(list) ? list : []).filter((w) => w && (w.path || w.root));
      if (usable.length) {
        usable.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        base = usable[0].path || usable[0].root;
        source = `workspaceRegistry:${usable[0].title || usable[0].id || 'unknown'}`;
      }
    } catch { /* 服务缺失 */ }
    if (!base) {
      try {
        const wd = ctx.get('workingDirectory');
        if (wd && wd.defaultDirectory) { base = wd.defaultDirectory; source = 'workingDirectory.defaultDirectory'; }
      } catch { /* 服务缺失 */ }
    }
    if (!base) { base = process.cwd(); source = 'process.cwd()'; }
    return { dir: path.join(base, 'art', 'ai', 'doubao_plugin'), source, base };
  };

  const outDirPath = () => resolveOutDir().dir;
  const defaultModel = config.model || DEFAULT_MODEL;
  const defaultSize = config.size || '2K';

  // 环境探测（.exe 是否存在、进程列表、arkcli --version）比较贵，短 TTL 缓存一下，
  // 否则每次打开面板都要 spawn 一遍 arkcli。
  const envCache = { at: 0, value: null };
  async function probeEnv(force = false) {
    if (!force && envCache.value && Date.now() - envCache.at < 15000) return envCache.value;
    const [arkcli, doubao, characters] = await Promise.all([probeArkcli(), probeDoubao(), charactersWithAspect()]);
    envCache.value = { arkcli, doubao, characters };
    envCache.at = Date.now();
    return envCache.value;
  }

  // ---- 统计：插件自己记 ARK 出图；豆包本地读工作区 imgforge 台账 ----
  const statsFile = () => path.join(outDirPath(), '_stats.json');

  function readPluginStats() {
    try { return JSON.parse(readFileSync(statsFile(), 'utf8')); } catch { return { days: {} }; }
  }

  function recordGeneration({ model, size, count, cash, list }) {
    const s = readPluginStats();
    const day = localDay(Date.now());
    s.days = s.days || {};
    const d = s.days[day] || (s.days[day] = {});
    const a = d.ark || (d.ark = { count: 0, cash: 0, list: 0 });
    a.count += count;
    a.cash += cash || 0;
    a.list += list || 0;
    try {
      mkdirSync(path.dirname(statsFile()), { recursive: true });
      writeFileSync(statsFile(), JSON.stringify(s, null, 2), 'utf8');
    } catch { /* 统计失败不影响出图 */ }
  }

  /** 本地豆包出图记录来自工作区台账 art/cost/ledger.jsonl（imgforge 那套工具写的） */
  function readLocalLedger() {
    const fp = path.join(resolveOutDir().base, 'art', 'cost', 'ledger.jsonl');
    if (!existsSync(fp)) return { available: false, path: fp, days: {} };
    const days = {};
    try {
      for (const line of readFileSync(fp, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let r = null;
        try { r = JSON.parse(line); } catch { continue; }
        if (!r || r.status !== 'ok') continue;
        const day = localDay(r.ts || Date.now());
        const d = days[day] || (days[day] = { local: { count: 0, cash: 0, list: 0 }, ark: { count: 0, cash: 0, list: 0 } });
        const bucket = r.route === 'doubao-desktop' ? d.local : d.ark;
        bucket.count += Number(r.outputCount || 0);
        bucket.cash += Number(r.amountCny || 0);
        bucket.list += Number(r.listValueCny != null ? r.listValueCny : (r.amountCny || 0));
      }
    } catch { /* 台账损坏时按空处理 */ }
    return { available: true, path: fp, days };
  }

  function statsSnapshot() {
    const day = localDay(Date.now());
    const plugin = readPluginStats();
    const ledger = readLocalLedger();
    const pToday = (plugin.days && plugin.days[day]) || {};
    const lToday = (ledger.days && ledger.days[day]) || {};
    const ark = {
      count: Number((pToday.ark && pToday.ark.count) || 0) + Number((lToday.ark && lToday.ark.count) || 0),
      cash: Number((pToday.ark && pToday.ark.cash) || 0) + Number((lToday.ark && lToday.ark.cash) || 0),
      list: Number((pToday.ark && pToday.ark.list) || 0) + Number((lToday.ark && lToday.ark.list) || 0),
    };
    const local = {
      count: Number((lToday.local && lToday.local.count) || 0),
      cash: Number((lToday.local && lToday.local.cash) || 0),
      list: Number((lToday.local && lToday.local.list) || 0),
    };
    // 全量合计
    const totals = { local: { count: 0, cash: 0, list: 0 }, ark: { count: 0, cash: 0, list: 0 } };
    for (const d of Object.values(ledger.days || {})) {
      for (const k of ['local', 'ark']) {
        const b = d[k];
        if (!b) continue;
        totals[k].count += Number(b.count || 0);
        totals[k].cash += Number(b.cash || 0);
        totals[k].list += Number(b.list || 0);
      }
    }
    for (const d of Object.values(plugin.days || {})) {
      const b = d.ark;
      if (!b) continue;
      totals.ark.count += Number(b.count || 0);
      totals.ark.cash += Number(b.cash || 0);
      totals.ark.list += Number(b.list || 0);
    }
    return { day, today: { local, ark }, totals, ledgerPath: ledger.path, ledgerAvailable: ledger.available };
  }

  // ---- 验证结果缓存：验证过一次就把网关/模型/单价落盘，下次打开直接显示，不再重新探测 ----
  const arkCacheFile = () => path.join(outDirPath(), '_ark_cache.json');

  function readArkCache() {
    try {
      const c = JSON.parse(readFileSync(arkCacheFile(), 'utf8'));
      return c && c.keyFingerprint ? c : null;
    } catch { return null; }
  }

  function writeArkCache(payload) {
    try {
      mkdirSync(path.dirname(arkCacheFile()), { recursive: true });
      writeFileSync(arkCacheFile(), JSON.stringify(payload, null, 2), 'utf8');
    } catch { /* 缓存失败不影响主流程 */ }
  }

  function patchArkCache(patch) {
    const cur = readArkCache();
    if (!cur) return null;
    const next = { ...cur, ...patch };
    writeArkCache(next);
    return next;
  }

  // ---- 额度用量缓存（落盘）：开面板时不联网，直接读上次结果；后台再刷新 ----
  const USAGE_TTL = 5 * 60 * 1000;
  const usageCacheFile = () => path.join(outDirPath(), '_usage_cache.json');

  function readUsageCache() {
    try {
      const c = JSON.parse(readFileSync(usageCacheFile(), 'utf8'));
      return c && c.value ? c : null;
    } catch { return null; }
  }

  function writeUsageCache(entry) {
    try {
      mkdirSync(path.dirname(usageCacheFile()), { recursive: true });
      writeFileSync(usageCacheFile(), JSON.stringify(entry, null, 2), 'utf8');
    } catch { /* 缓存失败不影响主流程 */ }
  }

  async function coreUsage(force = false) {
    const cached = readUsageCache();
    if (!force && cached && cached.at && Date.now() - cached.at < USAGE_TTL) return cached.value;

    const [volcengine, doubao] = await Promise.all([
      probePlanUsage().catch((e) => ({ available: false, reason: String(e && e.message || e) })),
      probeDoubaoQuota().catch((e) => ({ available: false, reason: String(e && e.message || e) })),
    ]);
    const value = { volcengine, doubao, fetchedAt: new Date().toISOString() };
    writeUsageCache({ at: Date.now(), value });
    return value;
  }

  // ---- 生图偏好（落盘）：工具在没显式指定 route 时按它来 ----
  const prefsFile = () => path.join(outDirPath(), '_prefs.json');

  function readPrefs() {
    try {
      const p = JSON.parse(readFileSync(prefsFile(), 'utf8'));
      return { defaultRoute: p && p.defaultRoute === 'local' ? 'local' : 'ark' };
    } catch { return { defaultRoute: 'ark' }; }
  }

  function writePrefs(next) {
    const value = { defaultRoute: next && next.defaultRoute === 'local' ? 'local' : 'ark' };
    mkdirSync(path.dirname(prefsFile()), { recursive: true });
    writeFileSync(prefsFile(), JSON.stringify(value, null, 2), 'utf8');
    return value;
  }

  // ---- 凭据 ----
  const fingerprint = (key) => (key ? `${key.length}:${key.slice(-6)}` : null);

  async function readApiKey() {
    try {
      const hit = await ctx.credentials.resolve(CREDENTIAL_KEY);
      return hit && typeof hit.value === 'string' && hit.value ? hit.value : null;
    } catch { return null; }
  }

  const cache = { keyFingerprint: null, gateways: null, models: null, modelsAt: 0 };

  async function saveApiKey(value) {
    await ctx.credentials.set(CREDENTIAL_KEY, value);
    cache.keyFingerprint = fingerprint(value);
    cache.gateways = null;
    cache.models = null;
    cache.modelsAt = 0;
  }

  async function clearApiKey() {
    try { await ctx.credentials.unset(CREDENTIAL_KEY); } catch { /* 未设置时忽略 */ }
    cache.keyFingerprint = null;
    cache.gateways = null;
    cache.models = null;
    cache.modelsAt = 0;
  }

  async function resolveGateways(apiKey) {
    if (cache.gateways && cache.keyFingerprint === fingerprint(apiKey)) return cache.gateways;
    const probed = await detectGateway(apiKey);
    cache.gateways = probed;
    cache.keyFingerprint = fingerprint(apiKey);
    return probed;
  }

  // ---- 角色清单（宽高比从 PNG 头里读，换素材自动跟随）----
  async function charactersWithAspect() {
    const out = [];
    for (const c of CHARACTERS) {
      let aspect = 1;
      try {
        const buf = await readFile(path.join(PKG_DIR, 'assets', c.assets.idle));
        const dim = pngSize(buf);
        if (dim && dim.h > 0) aspect = dim.w / dim.h;
      } catch { /* 素材缺失时按 1:1 */ }
      out.push({
        id: c.id,
        name: c.name,
        aspect: Math.round(aspect * 10000) / 10000,
        assets: {
          idle: `${PREFIX}/asset/${c.assets.idle}`,
          hover: `${PREFIX}/asset/${c.assets.hover}`,
          click: `${PREFIX}/asset/${c.assets.click}`,
        },
      });
    }
    return out;
  }

  // ---- 核心操作 ----
  async function coreStatus(forceEnv = false) {
    const env = await probeEnv(forceEnv);
    const { arkcli, doubao, characters } = env;
    const apiKey = await readApiKey();
    let gateway = null;
    let gatewayError = null;
    let arkCache = null;

    if (apiKey) {
      const cached = readArkCache();
      if (cached && cached.keyFingerprint === fingerprint(apiKey)) {
        // 命中缓存：不联网、不重新探测模型
        arkCache = cached;
        gateway = {
          base: cached.base, mode: cached.mode, cached: true,
          verifiedAt: cached.verifiedAt || null,
          all: [{ base: cached.base, mode: cached.mode, usable: true, status: 0 }],
        };
      } else {
        try {
          const probed = await resolveGateways(apiKey);
          const usable = probed.filter((p) => p.usable);
          gateway = usable.length
            ? { base: usable[0].base, mode: usable[0].mode, cached: false, all: probed.map((p) => ({ base: p.base, mode: p.mode, status: p.status, usable: p.usable })) }
            : null;
          if (!gateway) {
            const exists = await keyExists(apiKey);
            gatewayError = exists.ok
              ? '钥匙存在，但两个网关都不接受（401）：检查该 key 是否被禁用/限流，或它属于别的产品'
              : '方舟不认这把 key（连空请求都过不了存在性检查）';
          } else {
            // 网关确认了就落个基础缓存（模型留空，等真正同步时补）
            arkCache = {
              keyFingerprint: fingerprint(apiKey),
              keyHint: `…${apiKey.slice(-6)}`,
              verifiedAt: null,
              base: gateway.base,
              mode: gateway.mode,
              models: [],
              reachable: [],
              plan: null,
            };
            writeArkCache(arkCache);
          }
        } catch (err) {
          gatewayError = String(err && err.message || err);
        }
      }
    }
    return {
      ok: true,
      arkcli,
      doubao,
      ark: {
        keyConfigured: Boolean(apiKey),
        keyHint: apiKey ? `…${apiKey.slice(-6)}` : null,
        gateway,
        gatewayError,
        cache: arkCache,
        models: cachedReachableModels() || [],
        defaultModel,
      },
      config: { outDir: outDirPath(), outDirSource: resolveOutDir().source, model: defaultModel, size: defaultSize },
      characters,
      stats: statsSnapshot(),
      usage: (readUsageCache() || {}).value || null,
      prefs: readPrefs(),
      links: {
        doubaoDownload: (doubao && doubao.downloadUrl) || 'https://www.doubao.com/download',
        arkSubscribe: 'https://ark.volcengine.com/region:cn-beijing/subscription/agent-plan',
      },
    };
  }

  async function coreSyncModels(force = false) {
    const apiKey = await readApiKey();
    if (!apiKey) throw new Error('还没有配置火山引擎 API Key');

    // 已验证过且模型非空 → 直接回缓存，不再探测（除非 force）
    const cached = readArkCache();
    if (!force && cached && cached.keyFingerprint === fingerprint(apiKey) && Array.isArray(cached.models) && cached.models.length) {
      return {
        base: cached.base, mode: cached.mode, listed: [],
        reachable: cached.reachable || cached.models.filter((m) => m.reachable).map((m) => m.id),
        models: cached.models, cached: true, verifiedAt: cached.verifiedAt || null,
      };
    }

    const probed = await resolveGateways(apiKey);
    const usable = probed.filter((p) => p.usable);
    if (!usable.length) {
      const exists = await keyExists(apiKey);
      throw new Error(exists.ok
        ? '这把 key 在两个网关都返回 401：可能被禁用/限流，或不是方舟推理 key'
        : '方舟不认识这把 key，请检查是否复制完整');
    }
    const base = usable[0].base;
    const mode = billingModeOf(base);
    const { listed, candidates } = await listModels(apiKey, base);
    const models = await probeModels(apiKey, base, candidates);
    for (const m of models) m.price = unitPrice(m.id, '2K');   // 2K 单价（元/张），界面用来显示资费
    cache.models = { base, mode, models, listed };
    cache.modelsAt = Date.now();

    const verifiedAt = new Date().toISOString();
    const reachable = models.filter((m) => m.reachable).map((m) => m.id);
    writeArkCache({
      keyFingerprint: fingerprint(apiKey),
      keyHint: `…${apiKey.slice(-6)}`,
      verifiedAt,
      base,
      mode,
      models,
      reachable,
      plan: (cached && cached.plan) || null,
    });

    return { base, mode, listed, reachable, models, cached: false, verifiedAt };
  }

  /**
   * 本地豆包出图：调工作区里的 imgforge CLI（`doubao work`，走 CDP 驱动客户端工作模式）。
   * 只在这里起子进程，不改客户端状态；失败原因原样返回。
   */
  async function coreGenerateLocal({ prompt, count, fileBase } = {}) {
    const text = String(prompt || '').trim();
    if (!text) throw new Error('prompt 不能为空');
    const base = resolveOutDir().base;
    const cli = path.join(base, 'art', 'tools', 'imgforge', 'cli.js');
    if (!existsSync(cli)) {
      throw new Error(`本机没有 imgforge 工具，无法走本地豆包：${cli}`);
    }
    const n = Math.max(1, Math.min(4, Number(count) || 1));
    const name = fileBase || `doubao_local_${Date.now()}`;
    const outDir = outDirPath();
    const args = [cli, 'doubao', 'work', '--prompt', text, '--count', String(n), '--file', name, '--out', outDir];

    const started = Date.now();
    const res = await new Promise((resolve) => {
      execFile('node', args, { timeout: 15 * 60 * 1000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
        (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
    });
    const ms = Date.now() - started;

    const files = [];
    const seen = new Set();
    for (const m of res.stdout.matchAll(/→\s*(.+\.(?:png|jpg|jpeg|webp))\s*$/gim)) {
      const fp = m[1].trim();
      if (seen.has(fp) || !existsSync(fp)) continue;
      seen.add(fp);
      files.push({ name: path.basename(fp), path: fp, bytes: 0, url: `${PREFIX}/out/${encodeURIComponent(path.basename(fp))}` });
    }
    const ok = files.length > 0;
    return {
      ok,
      route: 'local',
      mode: 'local',
      model: 'doubao-desktop/work-mode',
      size: '',
      files,
      errors: ok ? [] : [{ message: (res.stderr || res.stdout || (res.err && res.err.message) || '本地出图失败').trim().slice(-1200) }],
      ms,
    };
  }

  /** 一次出图：显式 route 优先，否则按「生图偏好」；ark = 火山 API，local = 本机豆包工作模式 */
  async function coreGenerate({ prompt, size, count, model, route } = {}) {
    const explicit = String(route || '').trim().toLowerCase();
    const pref = readPrefs().defaultRoute || 'ark';
    const useLocal = explicit === 'local' || (!explicit && pref === 'local');
    if (useLocal) return await coreGenerateLocal({ prompt, count });
    return await coreGenerateArk({ prompt, size, count, model });
  }

  /** 套餐里可用的模型（来自验证缓存）；没缓存返回 null 表示未知 */
  function cachedReachableModels() {
    const cache = readArkCache();
    if (!cache || !Array.isArray(cache.models) || !cache.models.length) return null;
    return cache.models
      .filter((m) => m.reachable)
      .map((m) => ({ id: m.id, price: m.price == null ? null : m.price }));
  }

  /**
   * 决定这次用哪个模型：
   *  - 显式给了 model：必须在可用列表里，否则直接报错并列出可用项
   *  - 省略 / "auto"：在可用列表里挑，默认模型优先，其余按缓存顺序兜底
   */
  function planModelCandidates(requested) {
    const known = cachedReachableModels();
    const explicit = requested && String(requested).toLowerCase() !== 'auto' ? String(requested) : '';

    if (explicit) {
      if (known && known.length && !known.some((m) => m.id === explicit)) {
        throw new Error(`模型 ${explicit} 不在当前套餐的可用列表里。可用：${known.map((m) => m.id).join('、')}`);
      }
      return { mode: 'explicit', candidates: [explicit], known };
    }

    const ids = known ? known.map((m) => m.id) : [];
    if (!ids.length) return { mode: 'auto', candidates: [defaultModel], known: null };
    const ordered = ids.includes(defaultModel) ? [defaultModel, ...ids.filter((id) => id !== defaultModel)] : [...ids];
    return { mode: 'auto', candidates: ordered, known };
  }

  async function coreGenerateArk({ prompt, size, count, model } = {}) {
    const text = String(prompt || '').trim();
    if (!text) throw new Error('prompt 不能为空');
    const apiKey = await readApiKey();
    if (!apiKey) throw new Error('还没有配置火山引擎 API Key');

    let base = null;
    if (cache.gateways && cache.keyFingerprint === fingerprint(apiKey)) {
      const usable = cache.gateways.find((p) => p.usable);
      if (usable) base = usable.base;
    }
    if (!base) {
      const probed = await resolveGateways(apiKey);
      const usable = probed.find((p) => p.usable);
      if (!usable) throw new Error('网关鉴权失败：先在控制台「火山引擎生图」里校验 key');
      base = usable.base;
    }

    const pick = planModelCandidates(model);
    const effectiveSize = size || defaultSize;
    const mode = billingModeOf(base);
    const tried = [];
    let lastFail = null;

    for (const candidate of pick.candidates) {
      tried.push(candidate);
      const result = await generateImage({
        apiKey, base, model: candidate, prompt: text,
        size: effectiveSize, count: count || 1,
        outDir: outDirPath(), fileBase: 'doubao_pet',
      });
      if (result.files.length) {
        const unit = unitPrice(candidate, effectiveSize);
        const list = unit == null ? 0 : unit * result.files.length;
        recordGeneration({ model: candidate, size: effectiveSize, count: result.files.length, cash: mode === 'plan' ? 0 : list, list });
        return {
          ok: true,
          route: 'ark',
          base,
          mode,
          model: candidate,
          size: result.size,
          autoSelected: pick.mode === 'auto',
          tried,
          files: result.files.map((f) => ({ name: f.name, bytes: f.bytes, path: f.path, url: `${PREFIX}/out/${encodeURIComponent(f.name)}` })),
          errors: result.errors,
        };
      }
      lastFail = result;
      // 显式指定的模型不自动替换（用户意图明确）
      if (pick.mode === 'explicit') break;
      // 只有「模型不可用」才换下一个；额度/内容审核类错误换模型也没用
      const msg = JSON.stringify(result.errors || []);
      if (!/UnsupportedModel|not supported|invalid model|404/i.test(msg)) break;
    }

    return {
      ok: false,
      route: 'ark',
      base,
      mode,
      model: tried[tried.length - 1] || defaultModel,
      size: size || defaultSize,
      autoSelected: pick.mode === 'auto',
      tried,
      availableModels: pick.known ? pick.known.map((m) => m.id) : null,
      files: [],
      errors: (lastFail && lastFail.errors) || [{ message: '出图失败' }],
    };
  }

  // ---- HTTP ----
  function sendJson(res, status, payload) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(payload));
  }

  async function readJson(req, limit = 64 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > limit) throw new Error('请求体过大');
      chunks.push(buf);
    }
    if (!chunks.length) return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  function sameOrigin(req) {
    const host = req.headers.host;
    const origin = req.headers.origin;
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    if (!origin) return true;
    try {
      const u = new URL(origin);
      if (!host) return false;
      return u.host === host;
    } catch { return false; }
  }

  async function serveAsset(res, name) {
    if (!ASSET_ALLOWLIST.has(name)) return sendJson(res, 404, { error: 'no such asset' });
    try {
      const buf = await readFile(path.join(PKG_DIR, 'assets', name));
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-cache' });
      res.end(buf);
    } catch {
      sendJson(res, 404, { error: 'asset missing on disk' });
    }
  }

  async function serveOutput(res, name) {
    const safe = path.basename(name || '');
    if (!safe || safe !== name) return sendJson(res, 400, { error: 'bad name' });
    const fp = path.join(outDirPath(), safe);
    if (!existsSync(fp)) return sendJson(res, 404, { error: 'not found' });
    try {
      const buf = await readFile(fp);
      const ext = path.extname(safe).toLowerCase();
      const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
      res.end(buf);
    } catch {
      sendJson(res, 500, { error: 'read failed' });
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      const sub = url.pathname.slice(PREFIX.length) || '/';
      try {
        if (req.method === 'GET' && sub.startsWith('/asset/')) return await serveAsset(res, decodeURIComponent(sub.slice('/asset/'.length)));
        if (req.method === 'GET' && sub.startsWith('/out/')) return await serveOutput(res, decodeURIComponent(sub.slice('/out/'.length)));

        if (req.method === 'GET' && sub === '/api/status') {
          return sendJson(res, 200, await coreStatus(url.searchParams.get('refresh') === '1'));
        }
        if (req.method === 'GET' && sub === '/api/characters') return sendJson(res, 200, { ok: true, characters: await charactersWithAspect() });
        if (req.method === 'GET' && sub === '/api/stats') return sendJson(res, 200, { ok: true, ...statsSnapshot() });
        if (req.method === 'GET' && sub === '/api/prefs') return sendJson(res, 200, { ok: true, ...readPrefs() });
        if (req.method === 'GET' && sub === '/api/usage') {
          try { return sendJson(res, 200, { ok: true, ...(await coreUsage(url.searchParams.get('refresh') === '1')) }); }
          catch (err) { return sendJson(res, 200, { ok: false, error: String(err && err.message || err) }); }
        }

        if (req.method === 'GET' && sub === '/api/quota') {
          try { return sendJson(res, 200, { ok: true, ...(await probePlan()) }); }
          catch (err) { return sendJson(res, 200, { ok: false, error: String(err && err.message || err) }); }
        }

        if (req.method === 'GET' && sub === '/api/models') {
          const force = url.searchParams.get('refresh') === '1';
          if (!force && cache.models && Date.now() - cache.modelsAt < 120000) return sendJson(res, 200, { ok: true, cached: true, ...cache.models });
          try { return sendJson(res, 200, { ok: true, ...(await coreSyncModels(force)) }); }
          catch (err) { return sendJson(res, 200, { ok: false, error: String(err && err.message || err) }); }
        }

        if (req.method === 'POST') {
          if (!sameOrigin(req)) return sendJson(res, 403, { error: '跨站请求已拒绝' });
          const body = await readJson(req);

          if (sub === '/api/key') {
            if (body.clear) { await clearApiKey(); return sendJson(res, 200, { ok: true, cleared: true }); }
            const apiKey = String(body.apiKey || '').trim();
            if (!apiKey) return sendJson(res, 400, { error: 'apiKey 不能为空' });
            if (!/^ark-[A-Za-z0-9-]{8,}$/.test(apiKey)) return sendJson(res, 400, { error: '看起来不是 ark- 开头的方舟 API Key' });
            try { await saveApiKey(apiKey); }
            catch (err) { return sendJson(res, 500, { error: `保存密钥失败：${String(err && err.message || err)}` }); }
            try {
              const sync = await coreSyncModels(true);          // 验证时强制刷新一次
              const plan = await probePlan().catch(() => ({ available: false }));
              patchArkCache({ plan });
              return sendJson(res, 200, { ok: true, saved: true, keyHint: `…${apiKey.slice(-6)}`, ...sync, plan });
            } catch (err) {
              return sendJson(res, 200, { ok: true, saved: true, syncError: String(err && err.message || err) });
            }
          }

          if (sub === '/api/doubao/restart') {
            if (body.confirm !== true) return sendJson(res, 400, { error: '会关闭当前豆包并重启，需要显式确认（confirm: true）' });
            try {
              const result = await relaunchDoubaoWithDebug(9222);
              envCache.at = 0;                                   // 让下次 status 重新探测
              try { unlinkSync(usageCacheFile()); } catch { /* 没有缓存也无所谓 */ }
              return sendJson(res, 200, result);
            } catch (err) {
              return sendJson(res, 500, { ok: false, error: String(err && err.message || err) });
            }
          }

          if (sub === '/api/prefs') {
            try {
              const saved = writePrefs({ defaultRoute: body.defaultRoute });
              return sendJson(res, 200, { ok: true, ...saved });
            } catch (err) {
              return sendJson(res, 500, { ok: false, error: String(err && err.message || err) });
            }
          }

          if (sub === '/api/generate') {
            try { return sendJson(res, 200, await coreGenerate(body)); }
            catch (err) { return sendJson(res, 200, { ok: false, error: String(err && err.message || err) }); }
          }

          if (sub === '/api/deploy-arkcli') {
            if (body.confirm !== true) return sendJson(res, 400, { error: '需要显式确认（confirm: true）才会执行 npm 全局安装' });
            const result = await deployArkcli();
            envCache.at = 0;                 // 部署完让下次 status 重新探测
            return sendJson(res, 200, result);
          }

          return sendJson(res, 404, { error: 'unknown endpoint' });
        }
        sendJson(res, 404, { error: 'not found' });
      } catch (err) {
        sendJson(res, 500, { error: String(err && err.message || err) });
      }
    },
  }));

  // ---- Agent 工具 ----
  ctx.effect(() => ctx.tools.register({
    name: 'doubao_pet_status',
    description: 'Inspect the Doubao pet plugin: Ark CLI / Doubao desktop presence, whether a Volcengine Ark API key is configured and which gateway it belongs to, available characters, and today/total image-generation statistics (local Doubao vs Ark, with cash and list-value costs). Read-only.',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          arkcli: { type: 'object', additionalProperties: true },
          doubao: { type: 'object', additionalProperties: true },
          ark: { type: 'object', additionalProperties: true },
          stats: { type: 'object', additionalProperties: true },
          characters: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2).slice(0, 4000) }],
    },
    async execute() { return await coreStatus(); },
  }));

  ctx.effect(() => ctx.tools.register({
    name: 'doubao_generate_image',
    description: 'Generate images through either route of the Doubao pet plugin: route="ark" (default) calls the Volcengine Ark API with the stored key; route="local" drives the local Doubao desktop client work mode on this machine (free, slower, needs the client + imagegenforge tooling in the workspace). Usage guide: docs/IMAGE_GEN.md in the dsh-doubao-pet plugin package — read it first when you need images. Each call is recorded by the plugin statistics.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Text-to-image prompt. Chinese works well; include style, composition and background.' },
      route: { type: 'string', description: 'ark (Volcengine API, default) or local (local Doubao desktop work mode).' },
      size: { type: 'string', description: 'Ark only: "2K" (default), "4K", or "WxH" such as "1024x1024".' },
      count: { type: 'number', description: 'How many images, 1-4.' },
      model: { type: 'string', description: 'Ark only. Omit or "auto" to let the plugin pick from the models your plan actually supports (default model first, then fall back on UnsupportedModel). Pass an exact id to force it; ids not in the plan are rejected with the available list. Call doubao_pet_status to see ark.models (reachable ids + unit price). Known ids: ' + KNOWN_IMAGE_MODELS.join(', ') + '.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          model: { type: 'string' },
          size: { type: 'string' },
          files: { type: 'array', items: { type: 'object', additionalProperties: true } },
          errors: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2).slice(0, 4000) }],
    },
    async execute(args) { return await coreGenerate(args || {}); },
  }));

  ctx.logger?.info?.(`[doubao-pet] 输出目录 ${outDirPath()}（来源 ${resolveOutDir().source}）；默认模型 ${defaultModel}；网关候选 ${PLAN_BASE} / ${PAYG_BASE}`);
}
