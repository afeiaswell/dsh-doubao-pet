window.__ModuleLoader__.load({
  id: 'dsh-doubao-pet',
  factory(require) {
    const React = require('react');
    const { useState, useEffect, useRef, useCallback } = React;
    const h = React.createElement;

    const PREFS_KEY = 'dsh-doubao-pet:ui:v2';
    const MIN_SIZE = 48;
    const MAX_SIZE = 240;
    const DEFAULT_SIZE = 96;
    const SNAP_DISTANCE = 28;
    const EDGE = 0;
    const ASSET_VER = 'v3';

    function loadPrefs() { try { return JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; } }
    function savePrefs(patch) {
      try { window.localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...patch })); } catch { /* 忽略 */ }
    }
    function viewport() { return { w: Math.max(240, window.innerWidth || 1024), h: Math.max(240, window.innerHeight || 768) }; }
    function clamp(v, min, max) { return Math.min(Math.max(v, min), Math.max(min, max)); }

    async function api(pathname, init) {
      const res = await fetch('/doubao-pet' + pathname, init);
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* 非 JSON */ }
      if (!json) throw new Error(text.slice(0, 200) || `HTTP ${res.status}`);
      return json;
    }
    const postJson = (p, body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });

    const T = {
      bg: 'var(--dsw-alias-bg-overlay)', layer: 'var(--dsw-alias-bg-layer-1)', layer2: 'var(--dsw-alias-bg-layer-2)',
      border: 'var(--dsw-alias-border-l1)', border2: 'var(--dsw-alias-border-l2)',
      text: 'var(--dsw-alias-label-primary)', dim: 'var(--dsw-alias-label-secondary)',
      brand: 'var(--dsw-alias-brand-primary)', ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)', err: 'var(--dsw-alias-state-error-primary)',
    };

    const STYLE = `
.dbpet-root { position: fixed; z-index: 40; pointer-events: auto; font: 12px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; color: ${T.text}; }
.dbpet-pet { position: relative; width: 100%; height: 100%; cursor: grab; user-select: none; touch-action: none; }
.dbpet-pet:active { cursor: grabbing; }
.dbpet-pet img { width: 100%; height: 100%; object-fit: contain; display: block; pointer-events: none; }
.dbpet-pet.is-squish img { animation: dbpet-squish .62s cubic-bezier(.34,1.56,.64,1); transform-origin: 50% 88%; }
@keyframes dbpet-squish {
  0%   { transform: scale(1,1); }
  22%  { transform: scale(1.2,.8) translateY(4px); }
  46%  { transform: scale(.9,1.12) translateY(-3px); }
  70%  { transform: scale(1.06,.95); }
  100% { transform: scale(1,1); }
}
.dbpet-gear { position: absolute; top: -6px; right: -6px; width: 30px; height: 30px; border-radius: 10px;
  border: none; padding: 0; background: ${T.brand}; color: #fff; display: grid; place-items: center;
  cursor: pointer; opacity: 0; pointer-events: none; transform: scale(.9);
  transition: opacity .16s ease, transform .2s cubic-bezier(.34,1.56,.64,1), box-shadow .16s;
  box-shadow: 0 3px 10px rgba(0,0,0,.32); z-index: 2; }
/* 只在该出现的时候出现：悬浮形象 / 面板打开 / 键盘聚焦 */
.dbpet-root:hover .dbpet-gear, .dbpet-gear.is-open, .dbpet-gear:focus-visible { opacity: 1; pointer-events: auto; transform: scale(1); }
/* 扩大点击热区，避免贴边时点空 */
.dbpet-gear::before { content: ''; position: absolute; inset: -8px; border-radius: 14px; }
.dbpet-gear:hover { transform: scale(1.08); box-shadow: 0 6px 18px rgba(0,0,0,.42), 0 0 0 3px rgba(255,255,255,.5); }
.dbpet-gear:focus-visible { outline: 2px solid ${T.text}; outline-offset: 2px; }
.dbpet-resize { position: absolute; right: -2px; bottom: -2px; width: 16px; height: 16px; cursor: nwse-resize;
  opacity: 0; transition: opacity .16s ease; touch-action: none; }
.dbpet-root:hover .dbpet-resize, .dbpet-resize.is-active { opacity: 1; }
.dbpet-resize::after { content: ''; position: absolute; right: 2px; bottom: 2px; width: 8px; height: 8px;
  border-right: 2px solid ${T.dim}; border-bottom: 2px solid ${T.dim}; border-bottom-right-radius: 2px; }
.dbpet-bubble { position: absolute; min-width: 176px; max-width: 260px; padding: 8px 10px; border-radius: 10px;
  border: 1px solid ${T.border}; background: ${T.bg}; box-shadow: 0 10px 28px rgba(0,0,0,.28); backdrop-filter: blur(6px); }
.dbpet-bubble::after { content: ''; position: absolute; left: 18px; bottom: -6px; width: 10px; height: 10px;
  background: ${T.bg}; border-right: 1px solid ${T.border}; border-bottom: 1px solid ${T.border}; transform: rotate(45deg); }
.dbpet-bubble-title { font-size: 11px; color: ${T.dim}; margin-bottom: 4px; }
.dbpet-bubble-row { display: flex; justify-content: space-between; gap: 12px; font-size: 11px; line-height: 1.7; }
.dbpet-bubble-row b { font-weight: 600; }
.dbpet-bubble-sep { margin: 5px 0 3px; padding-top: 5px; border-top: 1px dashed ${T.border}; font-size: 10px; color: ${T.dim}; }
.dbpet-panel { position: absolute; width: min(392px, calc(100vw - 24px)); max-height: min(72vh, 620px); overflow: auto;
  border: 1px solid ${T.border}; border-radius: 14px; background: ${T.bg}; backdrop-filter: blur(8px);
  box-shadow: 0 18px 48px rgba(0,0,0,.3); z-index: 3; }
.dbpet-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px;
  border-bottom: 1px solid ${T.border}; position: sticky; top: 0; background: ${T.bg}; z-index: 1; }
.dbpet-title { font-size: 13px; font-weight: 600; }
.dbpet-tabs { display: flex; gap: 4px; padding: 8px 10px 0; }
.dbpet-tab { border: 1px solid transparent; background: transparent; color: ${T.dim}; padding: 5px 9px; border-radius: 8px; cursor: pointer; font-size: 12px; }
.dbpet-tab:hover { color: ${T.text}; background: ${T.layer2}; }
.dbpet-tab.is-active { color: ${T.text}; background: ${T.layer}; border-color: ${T.border}; }
.dbpet-body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 10px; }
.dbpet-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border: 1px solid ${T.border}; border-radius: 10px; background: ${T.layer}; }
.dbpet-row-main { min-width: 0; }
.dbpet-label { font-size: 12px; font-weight: 600; }
.dbpet-sub { font-size: 11px; color: ${T.dim}; word-break: break-all; }
.dbpet-btn { border: 1px solid ${T.border}; background: ${T.layer}; color: ${T.text}; border-radius: 8px; padding: 5px 10px; font-size: 12px; cursor: pointer; white-space: nowrap; text-decoration: none; display: inline-block; }
.dbpet-btn:hover { background: ${T.layer2}; border-color: ${T.border2}; }
.dbpet-btn:disabled { opacity: .5; cursor: not-allowed; }
.dbpet-btn.primary { background: ${T.brand}; border-color: ${T.brand}; color: #fff; }
.dbpet-btn.danger { color: ${T.err}; }
.dbpet-badge { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid currentColor; }
.dbpet-ok { color: ${T.ok}; } .dbpet-warn { color: ${T.warn}; } .dbpet-err { color: ${T.err}; } .dbpet-dim { color: ${T.dim}; }
.dbpet-input, .dbpet-select { width: 100%; box-sizing: border-box; border: 1px solid ${T.border}; background: ${T.layer}; color: ${T.text}; border-radius: 8px; padding: 6px 8px; font: inherit; }
.dbpet-input:focus, .dbpet-select:focus { outline: 2px solid ${T.brand}; outline-offset: -1px; }
.dbpet-field { display: flex; flex-direction: column; gap: 4px; }
.dbpet-field > label { font-size: 11px; color: ${T.dim}; }
.dbpet-note { font-size: 11px; line-height: 1.55; padding: 7px 9px; border-radius: 8px; border: 1px dashed ${T.border}; color: ${T.dim}; }
.dbpet-note.is-err { color: ${T.err}; border-color: ${T.err}; }
.dbpet-note.is-ok { color: ${T.ok}; border-color: ${T.ok}; }
.dbpet-inline { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.dbpet-range { width: 100%; accent-color: ${T.brand}; }
.dbpet-chars { display: flex; gap: 8px; }
.dbpet-char { flex: 1; border: 2px solid ${T.border}; border-radius: 12px; background: ${T.layer}; padding: 6px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.dbpet-char.is-active { border-color: ${T.brand}; }
.dbpet-char img { width: 54px; height: 54px; object-fit: contain; }
.dbpet-char span { font-size: 11px; }
.dbpet-models { display: flex; flex-direction: column; gap: 6px; max-height: 170px; overflow: auto; }
.dbpet-model { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 8px; border: 1px solid ${T.border}; border-radius: 8px; background: ${T.layer}; font-size: 11px; }
.dbpet-model code { font-family: ui-monospace, Consolas, monospace; font-size: 10.5px; }
.dbpet-modal { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; background: rgba(0,0,0,.42); }
.dbpet-modal-card { width: min(360px, calc(100vw - 48px)); border-radius: 14px; border: 1px solid ${T.border}; background: ${T.bg}; box-shadow: 0 24px 60px rgba(0,0,0,.42); overflow: hidden; }
.dbpet-modal-card > div { padding: 10px 12px; }
.dbpet-kv { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; line-height: 1.9; }
.dbpet-kv span:first-child { color: ${T.dim}; }
`;

    function Icon({ kind }) {
      if (kind === 'gear') {
        return h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
          h('path', { d: 'M4 8h7M15.5 8h4.5M4 16h4M12.5 16h7.5', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }),
          h('circle', { cx: 13.2, cy: 8, r: 2.3, stroke: 'currentColor', strokeWidth: 2 }),
          h('circle', { cx: 10.2, cy: 16, r: 2.3, stroke: 'currentColor', strokeWidth: 2 }));
      }
      return h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M6 6l12 12M18 6L6 18', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' }));
    }

    function money(n) {
      const v = Number(n || 0);
      return `¥${v.toFixed(2)}`;
    }

    function fmtTime(iso) {
      try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
      } catch { return ''; }
    }

    function Pet() {
      const prefsRef = useRef(null);
      if (prefsRef.current === null) prefsRef.current = loadPrefs();
      const p0 = prefsRef.current;

      const [characters, setCharacters] = useState([]);
      const [charId, setCharId] = useState(() => (p0.charId === 'sdniang' ? 'sdniang' : 'doubao'));
      const [size, setSize] = useState(() => clamp(Number(p0.size) || DEFAULT_SIZE, MIN_SIZE, MAX_SIZE));
      const [snap, setSnap] = useState(() => p0.snap !== false);
      const [pos, setPos] = useState(null);
      const [phase, setPhase] = useState('idle');
      const [squish, setSquish] = useState(false);
      const [hovering, setHovering] = useState(false);
      const [open, setOpen] = useState(false);
      const [tab, setTab] = useState('local');
      const [status, setStatus] = useState(null);
      const [statusErr, setStatusErr] = useState(null);
      const [usageLive, setUsageLive] = useState(null);   // 额度是异步补上的，不阻塞状态
      const [usageBusy, setUsageBusy] = useState(false);
      const [prefs, setPrefs] = useState(null);
      const [prefsBusy, setPrefsBusy] = useState(false);
      const [note, setNote] = useState(null);
      const [busy, setBusy] = useState('');
      const [keyInput, setKeyInput] = useState('');
      const [verify, setVerify] = useState(null);
      const [modal, setModal] = useState(false);
      const [quota, setQuota] = useState(null);
      const [quotaBusy, setQuotaBusy] = useState(false);
      const [resizing, setResizing] = useState(false);

      const timers = useRef([]);
      const dragRef = useRef(null);
      const resizeRef = useRef(null);
      const posRef = useRef(pos);
      const sizeRef = useRef(size);
      const snapRef = useRef(snap);
      const rootRef = useRef(null);
      const openRef = useRef(open);
      posRef.current = pos;
      sizeRef.current = size;
      snapRef.current = snap;
      openRef.current = open;

      useEffect(() => () => { timers.current.forEach((t) => clearTimeout(t)); }, []);
      const later = (fn, ms) => { const t = setTimeout(fn, ms); timers.current.push(t); return t; };

      const char = characters.find((c) => c.id === charId) || characters[0] || null;
      const aspect = char && char.aspect ? char.aspect : 0.89;
      const boxW = (s) => Math.round(s * aspect);
      const aspectRef = useRef(aspect);
      aspectRef.current = aspect;
      const bw = boxW(size);

      const clampPos = useCallback((x, y, s) => {
        const { w, h } = viewport();
        const width = Math.round(s * aspectRef.current);
        return { x: clamp(x, EDGE, w - width - EDGE), y: clamp(y, EDGE, h - s - EDGE) };
      }, []);

      const snapPos = useCallback((x, y, s) => {
        const { w, h } = viewport();
        const width = Math.round(s * aspectRef.current);
        const p = clampPos(x, y, s);
        const maxX = w - width - EDGE;
        const maxY = h - s - EDGE;
        if (Math.abs(x - EDGE) <= SNAP_DISTANCE) p.x = clamp(EDGE, EDGE, maxX);
        else if (Math.abs(x - maxX) <= SNAP_DISTANCE) p.x = clamp(maxX, EDGE, maxX);
        if (Math.abs(y - EDGE) <= SNAP_DISTANCE) p.y = clamp(EDGE, EDGE, maxY);
        else if (Math.abs(y - maxY) <= SNAP_DISTANCE) p.y = clamp(maxY, EDGE, maxY);
        return p;
      }, [clampPos]);

      // 初始位置：优先用记忆；否则右下角
      useEffect(() => {
        if (pos) return;
        const s = clamp(Number(p0.size) || DEFAULT_SIZE, MIN_SIZE, MAX_SIZE);
        const next = (typeof p0.x === 'number' && typeof p0.y === 'number')
          ? clampPos(p0.x, p0.y, s)
          : (() => { const { w, h } = viewport(); return clampPos(w - Math.round(s * aspect) - 14, h - s - 88, s); })();
        setPos(next);
      }, [pos, p0, clampPos, aspect]);

      const loadStatus = useCallback(async () => {
        try {
          const s = await api('/api/status');
          setStatus(s);
          setStatusErr(null);
          if (s && s.prefs) setPrefs(s.prefs);
          if (Array.isArray(s.characters) && s.characters.length) {
            setCharacters(s.characters);
            if (!s.characters.some((c) => c.id === charId)) setCharId(s.characters[0].id);
          }
          return s;
        } catch (err) {
          setStatusErr(String(err && err.message || err));
          return null;
        }
      }, [charId]);

      /** 额度单独拉：先渲染（用磁盘缓存），再后台补最新，避免开面板卡住 */
      const loadUsage = useCallback(async (force = false) => {
        setUsageBusy(true);
        try {
          const u = await api('/api/usage' + (force ? '?refresh=1' : ''));
          if (u && !u.error) setUsageLive(u);
          return u;
        } catch (err) {
          return null;
        } finally {
          setUsageBusy(false);
        }
      }, []);

      const savePrefs = async (patch) => {
        setPrefsBusy(true);
        try {
          const r = await postJson('/api/prefs', { ...(prefs || {}), ...patch });
          if (r && r.ok) setPrefs({ defaultRoute: r.defaultRoute });
          await loadStatus();
        } catch (err) {
          setNote({ kind: 'err', text: String(err && err.message || err) });
        } finally { setPrefsBusy(false); }
      };

      useEffect(() => { loadStatus(); }, [loadStatus]);
      useEffect(() => {
        loadUsage(false);
        // 打开面板时再补一次（命中 5 分钟缓存就直接回）
        if (open) loadUsage(false);
      }, [open, loadUsage]);

      // 窗口变化：夹回可视区
      useEffect(() => {
        const onResize = () => setPos((p) => (p ? clampPos(p.x, p.y, sizeRef.current) : p));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
      }, [clampPos]);

      // 只有点到形象/设置界面之外才关闭（且忽略“刚打开那一下”）
      useEffect(() => {
        if (!open) return undefined;
        let armed = false;
        const armTimer = setTimeout(() => { armed = true; }, 0);
        const onPointerDown = (event) => {
          if (!armed) return;
          const root = rootRef.current;
          if (root && event.target instanceof Node && root.contains(event.target)) return;
          setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => {
          clearTimeout(armTimer);
          document.removeEventListener('pointerdown', onPointerDown, true);
        };
      }, [open]);

      const presetClick = () => {
        setPhase('click');
        setSquish(true);
        later(() => setSquish(false), 640);
        later(() => setPhase('idle'), 950);
      };

      // ---- 拖动 ----
      const onPetPointerDown = (e) => {
        if (e.button !== 0) return;
        dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origX: posRef.current.x, origY: posRef.current.y, moved: false };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
      };
      const onPetPointerMove = (e) => {
        const d = dragRef.current;
        if (!d || d.pointerId !== e.pointerId) return;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true;
        if (d.moved) setPos(clampPos(d.origX + dx, d.origY + dy, sizeRef.current));
      };
      const onPetPointerUp = (e) => {
        const d = dragRef.current;
        if (!d || d.pointerId !== e.pointerId) return;
        dragRef.current = null;
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
        if (d.moved) {
          const raw = posRef.current;
          const final = snapRef.current ? snapPos(raw.x, raw.y, sizeRef.current) : raw;
          setPos(final);
          posRef.current = final;
          savePrefs({ x: final.x, y: final.y });
        } else {
          presetClick();
        }
      };

      // ---- 缩放 ----
      const commitSize = (next) => {
        const s = clamp(Math.round(next), MIN_SIZE, MAX_SIZE);
        setSize(s); sizeRef.current = s;
        setPos((p) => (p ? clampPos(p.x, p.y, s) : p));
      };
      const onResizePointerDown = (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        resizeRef.current = { pointerId: e.pointerId, startX: e.clientX, startSize: sizeRef.current };
        setResizing(true);
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
      };
      const onResizePointerMove = (e) => {
        const r = resizeRef.current;
        if (!r || r.pointerId !== e.pointerId) return;
        commitSize(r.startSize + (e.clientX - r.startX) / (aspectRef.current || 1));
      };
      const onResizePointerUp = (e) => {
        const r = resizeRef.current;
        if (!r || r.pointerId !== e.pointerId) return;
        resizeRef.current = null;
        setResizing(false);
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
        savePrefs({ size: sizeRef.current, x: posRef.current.x, y: posRef.current.y });
      };

      const resetLayout = () => {
        const s = DEFAULT_SIZE;
        const { w, h } = viewport();
        const next = clampPos(w - Math.round(s * aspect) - 14, h - s - 88, s);
        setSize(s); sizeRef.current = s;
        setPos(next);
        savePrefs({ size: s, x: next.x, y: next.y });
      };

      const pickCharacter = (id) => {
        setCharId(id);
        savePrefs({ charId: id });
      };

      // ---- 数据操作 ----
      const verifyKey = async () => {
        const value = keyInput.trim();
        if (!value) { setNote({ kind: 'err', text: '先填 API Key' }); return; }
        setBusy('key'); setNote(null);
        try {
          const r = await postJson('/api/key', { apiKey: value });
          if (r.error) throw new Error(r.error);
          if (r.syncError) throw new Error(r.syncError);
          setVerify({
            keyHint: r.keyHint || `…${value.slice(-6)}`,
            base: r.base, mode: r.mode,
            models: r.models || [],
            reachable: r.reachable || [],
            total: (r.models || []).length,
            verifiedAt: r.verifiedAt,
            plan: r.plan,
          });
          setModal(true);
          setKeyInput('');
          await loadStatus();
        } catch (err) {
          setNote({ kind: 'err', text: String(err && err.message || err) });
        } finally { setBusy(''); }
      };

      const clearKey = async () => {
        setBusy('key');
        try {
          await postJson('/api/key', { clear: true });
          setVerify(null);
          setNote({ kind: 'ok', text: '已清除本机保存的 API Key' });
          await loadStatus();
        } catch (err) { setNote({ kind: 'err', text: String(err && err.message || err) }); }
        finally { setBusy(''); }
      };

      const loadQuota = async () => {
        setQuotaBusy(true);
        try { setQuota(await api('/api/quota')); }
        catch (err) { setQuota({ available: false, reason: String(err && err.message || err) }); }
        finally { setQuotaBusy(false); }
      };

      /** 重新探测模型（绕过缓存），结果写回服务端缓存 */
      const rescan = async () => {
        setBusy('scan');
        setNote(null);
        try {
          const r = await api('/api/models?refresh=1');
          if (r.ok === false) throw new Error(r.error || '探测失败');
          setVerify({
            keyHint: (status && status.ark && status.ark.keyHint) || '',
            base: r.base, mode: r.mode,
            models: r.models || [],
            reachable: r.reachable || [],
            total: (r.models || []).length,
            verifiedAt: r.verifiedAt,
            plan: (status && status.ark && status.ark.cache && status.ark.cache.plan) || null,
          });
          await loadStatus();
          setNote({ kind: 'ok', text: '已重新探测并更新缓存' });
        } catch (err) { setNote({ kind: 'err', text: String(err && err.message || err) }); }
        finally { setBusy(''); }
      };

      /** 关掉豆包再带调试端口重启（两步确认，避免误点） */
      const [armRestart, setArmRestart] = useState(false);
      const restartDoubao = async () => {
        if (!armRestart) {
          setArmRestart(true);
          setNote({ kind: 'warn', text: '再点一次确认：会关闭当前豆包窗口，并用调试端口重新启动（额度自动读取依赖这个端口）' });
          return;
        }
        setArmRestart(false);
        setBusy('restart');
        setNote({ text: '正在关闭豆包…' });
        try {
          const r = await postJson('/api/doubao/restart', { confirm: true });
          if (r && r.ok) {
            setNote({ kind: 'ok', text: `已带调试端口重启，端口 ${r.waitedMs}ms 就绪` });
            await loadStatus();
            await loadUsage(true);
          } else {
            setNote({ kind: 'err', text: (r && r.error) || '重启失败' });
            await loadStatus();
          }
        } catch (err) {
          setNote({ kind: 'err', text: String(err && err.message || err) });
        } finally { setBusy(''); }
      };

      /** 重新静默读一次额度（接口读取，不弹窗） */
      const readDoubaoQuota = async () => {
        setBusy('quota');
        setNote(null);
        try {
          const u = await loadUsage(true);
          const d = u && u.doubao;
          if (d && d.available) setNote({ kind: 'ok', text: `豆包额度：${d.used}/${d.total}（自动读取成功）` });
          else setNote({ kind: 'warn', text: (d && d.reason) || '自动读取失败，可用「以调试端口重启豆包」后重试' });
        } catch (err) {
          setNote({ kind: 'err', text: String(err && err.message || err) });
        } finally { setBusy(''); }
      };

      const deploy = async (kind) => {        setBusy(kind); setNote(null);
        try {
          if (kind === 'arkcli') {
            const r = await postJson('/api/deploy-arkcli', { confirm: true });
            setNote({ kind: r.ok ? 'ok' : 'err', text: r.ok ? `Ark CLI 就绪：v${r.version || '?'}` : (r.detail || '部署失败') });
          }
          await loadStatus();
        } catch (err) { setNote({ kind: 'err', text: String(err && err.message || err) }); }
        finally { setBusy(''); }
      };

      // ---- 视图 ----
      const assets = char ? char.assets : { idle: '/doubao-pet/asset/doubao.png', hover: '/doubao-pet/asset/doubao-smile.png', click: '/doubao-pet/asset/doubao-squint.png' };
      const src = `${(phase === 'click' ? assets.click : phase === 'hover' ? assets.hover : assets.idle)}?${ASSET_VER}`;
      const stats = status && status.stats ? status.stats : null;
      const today = stats && stats.today ? stats.today : { local: { count: 0, cash: 0, list: 0 }, ark: { count: 0, cash: 0, list: 0 } };
      const arkCash = Number(today.ark.cash || 0);
      const arkList = Number(today.ark.list || 0);
      const planMode = status && status.ark && status.ark.gateway && status.ark.gateway.mode === 'plan';

      const { w: vw, h: vh } = viewport();
      const panelUp = pos ? pos.y + size > vh * 0.55 : true;
      const panelRight = pos ? pos.x + bw / 2 > vw / 2 : true;
      const panelStyle = pos ? {
        [panelUp ? 'bottom' : 'top']: size + 12,
        [panelRight ? 'right' : 'left']: 0,
        maxHeight: Math.max(220, Math.min(vh * 0.72, panelUp ? pos.y + size - 24 : vh - pos.y - size - 24)),
      } : {};

      // 齿轮位置交给 CSS（贴在形象右上角、与形象重叠），不再动态外扩，
      // 否则鼠标从形象移到按钮之间会离开 :hover，按钮消失 → 点不到。
      const bubbleStyle = pos ? { [pos.y < 140 ? 'top' : 'bottom']: size + 14, left: -6, } : {};
      const showBubble = hovering && !open && !dragRef.current;

      // ---- 额度用量（异步补上；先显示磁盘缓存，不阻塞界面）----
      const usage = usageLive || (status && status.usage) || null;
      const volcPeriods = usage && usage.volcengine && usage.volcengine.available && Array.isArray(usage.volcengine.items)
        ? usage.volcengine.items.flatMap((it) => (it.periods || []).map((p) => ({ ...p, tier: it.tier })))
        : [];
      const doubaoQuota = usage && usage.doubao ? usage.doubao : null;
      const periodLabel = (label) => ({ '5h': '5 小时', weekly: '本周', monthly: '本月' }[label] || label);
      const localInstalled = Boolean(status && status.doubao && status.doubao.installed);
      const localRunning = Boolean(status && status.doubao && status.doubao.running);

      const localTab = h('div', { className: 'dbpet-body' },
        h('div', { className: 'dbpet-row' },
          h('div', { className: 'dbpet-row-main' },
            h('div', { className: 'dbpet-label' }, '豆包本地生图'),
            h('div', { className: 'dbpet-sub' },
              !status ? '检测中…'
                : localInstalled
                  ? `${status.doubao.exe}${localRunning ? ' · 运行中' : ' · 未运行（用到时会自行启动）'}`
                  : '未检测到豆包客户端')),
          h('div', { className: 'dbpet-inline' },
            h('span', { className: 'dbpet-badge ' + (localInstalled ? 'dbpet-ok' : 'dbpet-warn') }, localInstalled ? 'OK' : '未就绪'),
            localInstalled ? null : h('a', {
              className: 'dbpet-btn primary', target: '_blank', rel: 'noreferrer',
              href: (status && status.links && status.links.doubaoDownload) || 'https://www.doubao.com/download',
            }, '安装'))),
        localInstalled
          ? h('div', { className: 'dbpet-field' },
            h('label', null, '本地额度与出图开销'),
            h('div', { className: 'dbpet-note' },
              doubaoQuota && doubaoQuota.available
                ? `额度：${doubaoQuota.used.toLocaleString()}/${doubaoQuota.total.toLocaleString()}（${doubaoQuota.percent.toFixed(2)}%）`
                  + (doubaoQuota.plan ? ` · ${doubaoQuota.plan}` : '')
                  + (doubaoQuota.price ? ` · ${doubaoQuota.price}/月` : '')
                  + (doubaoQuota.renewAt ? ` · 续费 ${fmtTime(doubaoQuota.renewAt)}` : '')
                : `额度：未读取 — ${(doubaoQuota && doubaoQuota.reason) || '客户端未开启调试端口'}`),
            h('div', { className: 'dbpet-inline' },
              h('button', { className: 'dbpet-btn', onClick: readDoubaoQuota, disabled: busy === 'quota' },
                busy === 'quota' ? '读取中…' : '重新读取')),
            h('div', { className: 'dbpet-note' },
              '额度是直接调客户端自己的接口读的（不弹窗）。这个接口只在客户端带调试端口启动时可用；'
              + '若显示「未读取」，用下面的按钮带端口重启一次即可。'),
            h('div', { className: 'dbpet-inline' },
              h('button', {
                className: 'dbpet-btn' + (armRestart ? ' danger' : ''),
                onClick: restartDoubao,
                disabled: busy === 'restart',
              }, busy === 'restart' ? '重启中…' : (armRestart ? '确认重启（会关闭豆包）' : '以调试端口重启豆包'))),
            h('div', { className: 'dbpet-note' },
              `今日 ${today.local.count} 张 · ${money(today.local.cash)}（订阅额度）`),
            h('div', { className: 'dbpet-note' },
              `累计 ${stats ? stats.totals.local.count : 0} 张 · ${money(stats ? stats.totals.local.cash : 0)}`))
          : h('div', { className: 'dbpet-note' }, '装好豆包客户端后会自动读取本地出图统计（来自工作区 art/cost/ledger.jsonl）。'),
        h('div', { className: 'dbpet-inline', style: { justifyContent: 'flex-end' } },
          h('button', { className: 'dbpet-btn', onClick: loadStatus }, '刷新')));

      const arkKeyOk = Boolean(status && status.ark && status.ark.keyConfigured);
      const arkCache = status && status.ark && status.ark.cache ? status.ark.cache : null;
      const modelList = (verify && Array.isArray(verify.models) && verify.models.length)
        ? verify.models
        : (arkCache && Array.isArray(arkCache.models) ? arkCache.models : []);
      const reachableModelList = modelList.filter((m) => m.reachable);
      const verifiedAt = (verify && verify.verifiedAt) || (arkCache && arkCache.verifiedAt) || null;
      const arkTab = h('div', { className: 'dbpet-body' },
        h('div', { className: 'dbpet-row' },
          h('div', { className: 'dbpet-row-main' },
            h('div', { className: 'dbpet-label' }, '火山引擎生图环境'),
            h('div', { className: 'dbpet-sub' },
              !status ? '检测中…'
                : `${status.arkcli && status.arkcli.installed ? `Ark CLI v${status.arkcli.version}` : 'Ark CLI 未安装'} · ${arkKeyOk ? `Key ${status.ark.keyHint}` : '未配置 Key'}`)),
          h('div', { className: 'dbpet-inline' },
            h('span', { className: 'dbpet-badge ' + (arkKeyOk ? 'dbpet-ok' : 'dbpet-warn') }, arkKeyOk ? 'OK' : '未就绪'),
            status && status.arkcli && status.arkcli.installed
              ? null
              : h('button', { className: 'dbpet-btn primary', disabled: busy === 'arkcli', onClick: () => deploy('arkcli') },
                busy === 'arkcli' ? '部署中…' : '部署 Ark CLI'))),
        status && status.ark && status.ark.gateway
          ? h('div', { className: 'dbpet-note is-ok' },
            `网关 ${status.ark.gateway.mode === 'plan' ? '套餐订阅' : '按量付费'} · 今日 ${today.ark.count} 张 · ${planMode ? `现金 ¥0 / 折算 ${money(arkList)}` : money(arkCash)}`)
          : (status && status.ark && status.ark.gatewayError ? h('div', { className: 'dbpet-note is-err' }, status.ark.gatewayError) : null),
        h('div', { className: 'dbpet-field' },
          h('label', null, 'API Key'),
          h('input', {
            className: 'dbpet-input', type: 'password', autoComplete: 'off',
            placeholder: arkKeyOk ? `已保存 ${status.ark.keyHint}（重新填写可覆盖）` : 'ark-…',
            value: keyInput, onChange: (e) => setKeyInput(e.target.value),
          })),
        h('div', { className: 'dbpet-inline' },
          h('button', { className: 'dbpet-btn primary', onClick: verifyKey, disabled: busy === 'key' }, busy === 'key' ? '验证中…' : '验证'),
          h('button', { className: 'dbpet-btn', onClick: loadQuota, disabled: quotaBusy }, quotaBusy ? '查询中…' : '查套餐'),
          h('a', { className: 'dbpet-btn', target: '_blank', rel: 'noreferrer', href: (status && status.links && status.links.arkSubscribe) || 'https://ark.volcengine.com/region:cn-beijing/subscription/agent-plan' }, '开通'),
          arkKeyOk ? h('button', { className: 'dbpet-btn danger', onClick: clearKey, disabled: busy === 'key' }, '清除') : null),
        note ? h('div', { className: 'dbpet-note' + (note.kind === 'err' ? ' is-err' : note.kind === 'ok' ? ' is-ok' : '') }, note.text) : null,
        modelList.length
          ? h('div', { className: 'dbpet-field' },
            h('label', null, `可用模型（${reachableModelList.length} / ${modelList.length}）`),
            h('div', { className: 'dbpet-models' },
              modelList.map((m) => h('div', { className: 'dbpet-model', key: m.id },
                h('code', null, m.id),
                h('span', {
                  className: m.reachable ? 'dbpet-ok' : 'dbpet-dim',
                  title: m.detail || '',
                }, m.reachable
                  ? (m.price == null ? '可用 · 单价未知' : `可用 · ${money(m.price)}/张`)
                  : (m.state === 'quota' ? '额度受限' : m.state === 'absent' ? '不在套餐' : m.state))))),
            h('div', { className: 'dbpet-inline' },
              h('span', { className: 'dbpet-sub' }, verifiedAt ? `上次验证 ${fmtTime(verifiedAt)}` : '来自缓存'),
              h('button', { className: 'dbpet-btn', onClick: rescan, disabled: busy === 'scan' }, busy === 'scan' ? '探测中…' : '重新探测')))
          : h('div', { className: 'dbpet-note' }, '填好 Key 点「验证」，会判定网关并列出该套餐能用的模型与单价；没有 Key 点「开通」。验证结果会缓存，下次打开直接显示。'),
        quota
          ? h('div', { className: 'dbpet-note' + (quota.available ? ' is-ok' : '') },
            quota.available
              ? ((quota.plans && quota.plans.length)
                ? quota.plans.map((p) => `${p.name || p.key}${p.tier ? ' / ' + p.tier : ''}${p.status ? ' · ' + p.status : ''}`).join('；')
                : 'Ark CLI 已应答，但没有返回套餐列表')
              : `${quota.reason || '不可用'}${quota.detail ? '：' + quota.detail : ''}`)
          : null);

      const appearanceTab = h('div', { className: 'dbpet-body' },
        h('div', { className: 'dbpet-field' },
          h('label', null, '生图偏好（没指定 route 时默认走这条）'),
          h('div', { className: 'dbpet-inline' },
            [['ark', '火山引擎 API'], ['local', '豆包本地工作模式']].map(([value, label]) => h('button', {
              key: value,
              className: 'dbpet-btn' + ((prefs && prefs.defaultRoute === value) ? ' primary' : ''),
              disabled: prefsBusy,
              onClick: () => savePrefs({ defaultRoute: value }),
            }, label)))),
        h('div', { className: 'dbpet-note' },
          (prefs && prefs.defaultRoute === 'local')
            ? '当前默认：豆包本地工作模式（¥0，1–3 分钟，会在豆包项目里建对话）'
            : '当前默认：火山引擎 API（3–15 秒，套餐内 ¥0 / 按量按张计费）'),
        h('div', { className: 'dbpet-field' },
          h('label', null, 'Ark 模型偏好（不指定 model 时按这个挑）'),
          h('div', { className: 'dbpet-inline' },
            [['fast', '速度 / 经济优先'], ['quality', '质量优先']].map(([value, label]) => h('button', {
              key: value,
              className: 'dbpet-btn' + ((prefs && prefs.modelPreference === value) ? ' primary' : ''),
              disabled: prefsBusy,
              onClick: () => savePrefs({ modelPreference: value }),
            }, label)))),
        h('div', { className: 'dbpet-note' },
          (prefs && prefs.modelPreference === 'quality')
            ? '质量优先：先用套餐里最贵的模型（现在通常是 5.0 pro ¥0.30/张），失败自动回落到便宜的'
            : '速度 / 经济优先：先用套餐里最便宜的模型（现在通常是 5.0 flash ¥0.12/张），失败自动回落到其他'),
        h('div', { className: 'dbpet-field' },
          h('label', null, '形象'),
          h('div', { className: 'dbpet-chars' },
            (characters.length ? characters : [{ id: 'doubao', name: '豆包', aspect: 1, assets: { idle: assets.idle } }, { id: 'sdniang', name: 'sd娘', aspect: 1, assets: { idle: assets.idle } }])
              .map((c) => h('button', {
                key: c.id, type: 'button', className: 'dbpet-char' + (c.id === charId ? ' is-active' : ''),
                onClick: () => pickCharacter(c.id),
              },
              h('img', { src: `${c.assets.idle}?${ASSET_VER}`, alt: c.name }),
              h('span', null, c.name))))),
        h('div', { className: 'dbpet-row' },
          h('div', { className: 'dbpet-row-main' },
            h('div', { className: 'dbpet-label' }, '拖动时自动贴边'),
            h('div', { className: 'dbpet-sub' }, '离边缘 28px 内松手就贴齐，可贴角落')),
          h('button', { className: 'dbpet-btn', onClick: () => { const v = !snapRef.current; snapRef.current = v; setSnap(v); savePrefs({ snap: v }); } }, snap ? '已开启' : '已关闭')),
        h('div', { className: 'dbpet-field' },
          h('label', null, `形象大小：${size}px`),
          h('input', {
            className: 'dbpet-range', type: 'range', min: MIN_SIZE, max: MAX_SIZE, step: 4, value: size,
            onChange: (e) => commitSize(Number(e.target.value)),
            onPointerUp: () => savePrefs({ size: sizeRef.current }),
          })),
        h('div', { className: 'dbpet-inline' },
          h('button', { className: 'dbpet-btn', onClick: () => { commitSize(size - 8); savePrefs({ size: sizeRef.current }); } }, '缩小'),
          h('button', { className: 'dbpet-btn', onClick: () => { commitSize(size + 8); savePrefs({ size: sizeRef.current }); } }, '放大'),
          h('button', { className: 'dbpet-btn', onClick: resetLayout }, '复位位置与大小')));

      const tabBody = tab === 'local' ? localTab : tab === 'ark' ? arkTab : appearanceTab;
      const tabBtn = (id, label) => h('button', {
        key: id, className: 'dbpet-tab' + (tab === id ? ' is-active' : ''), onClick: () => setTab(id),
      }, label);

      return h('div', {
        className: 'dbpet-root',
        ref: rootRef,
        style: pos ? { left: pos.x, top: pos.y, width: bw, height: size } : { left: -9999, top: -9999, width: bw, height: size },
      },
      h('style', null, STYLE),
      open ? h('div', { className: 'dbpet-panel', role: 'dialog', 'aria-label': '豆包控制台', style: panelStyle, onPointerDown: (e) => e.stopPropagation() },
        h('div', { className: 'dbpet-head' },
          h('span', { className: 'dbpet-title' }, '豆包控制台'),
          h('button', {
            className: 'dbpet-btn', onClick: () => setOpen(false), 'aria-label': '关闭',
            style: { padding: '3px 6px', display: 'grid', placeItems: 'center' },
          }, h(Icon, null))),
        h('div', { className: 'dbpet-tabs' }, tabBtn('local', '豆包本地生图'), tabBtn('ark', '火山引擎生图'), tabBtn('appearance', '外观设置')),
        tabBody)
        : null,
      showBubble ? h('div', { className: 'dbpet-bubble', style: bubbleStyle },
        h('div', { className: 'dbpet-bubble-title' }, '今日消耗'),
        h('div', { className: 'dbpet-bubble-row' }, h('span', null, '豆包本地'), h('b', null, `${today.local.count} 张 · ${money(today.local.cash)}`)),
        h('div', { className: 'dbpet-bubble-row' }, h('span', null, '火山引擎'), h('b', null, `${today.ark.count} 张 · ${planMode ? money(arkList) + '(折算)' : money(arkCash)}`)),
        h('div', { className: 'dbpet-bubble-sep' }, '额度'),
        volcPeriods.length
          ? volcPeriods.map((p) => h('div', { className: 'dbpet-bubble-row', key: `v-${p.label}` },
            h('span', null, `火山 ${periodLabel(p.label)}`),
            h('b', { title: p.resetAt ? `重置：${fmtTime(p.resetAt)}` : '' },
              `${p.used}/${p.total}  ${p.total ? ((p.used / p.total) * 100).toFixed(2) : '0.00'}%`)))
          : h('div', { className: 'dbpet-bubble-row' }, h('span', null, '火山额度'), h('b', { className: 'dbpet-dim' }, '未读取')),
        h('div', { className: 'dbpet-bubble-row' }, h('span', null, '豆包额度'),
          doubaoQuota && doubaoQuota.available
            ? h('b', null, `${doubaoQuota.used}/${doubaoQuota.total}  ${((doubaoQuota.used / doubaoQuota.total) * 100).toFixed(2)}%`)
            : h('b', { className: 'dbpet-dim', title: (doubaoQuota && doubaoQuota.reason) || '' }, '未读取')),
        h('div', { className: 'dbpet-bubble-row dbpet-dim' }, h('span', null, '今日合计'),
          h('span', null, `${Number(today.local.count || 0) + Number(today.ark.count || 0)} 张`)))
        : null,
      h('div', {
        className: 'dbpet-pet' + (squish ? ' is-squish' : ''),
        role: 'button', tabIndex: 0,
        'aria-label': `${char ? char.name : '豆包'}（拖动移动，单击捏一下）`,
        title: '拖动移动 · 单击捏一下 · 悬浮看资费',
        onPointerDown: onPetPointerDown,
        onPointerMove: onPetPointerMove,
        onPointerUp: onPetPointerUp,
        onPointerCancel: onPetPointerUp,
        onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); presetClick(); } },
        onMouseEnter: () => { setHovering(true); setPhase((p) => (p === 'click' ? p : 'hover')); },
        onMouseLeave: () => { setHovering(false); setPhase((p) => (p === 'click' ? p : 'idle')); },
      },
      h('button', {
        className: 'dbpet-gear' + (open ? ' is-open' : ''),
        'aria-label': '打开豆包控制台', title: '打开豆包控制台',
        onPointerDown: (e) => { e.stopPropagation(); },
        onPointerUp: (e) => { e.stopPropagation(); },
        onClick: (e) => { e.stopPropagation(); setOpen(true); loadStatus(); },
      }, h(Icon, { kind: 'gear' })),
      h('img', { src, alt: char ? char.name : '豆包', draggable: false }),
      h('div', {
        className: 'dbpet-resize' + (resizing ? ' is-active' : ''),
        role: 'separator', 'aria-label': '拖拽调整大小', title: '拖拽调整大小',
        onPointerDown: onResizePointerDown,
        onPointerMove: onResizePointerMove,
        onPointerUp: onResizePointerUp,
        onPointerCancel: onResizePointerUp,
      })),
      modal && verify ? h('div', { className: 'dbpet-modal', onPointerDown: () => setModal(false) },
        h('div', { className: 'dbpet-modal-card', onPointerDown: (e) => e.stopPropagation() },
          h('div', { className: 'dbpet-head' },
            h('span', { className: 'dbpet-title' }, '验证通过'),
            h('button', { className: 'dbpet-btn', onClick: () => setModal(false), 'aria-label': '关闭', style: { padding: '3px 6px' } }, h(Icon, null))),
          h('div', null,
            h('div', { className: 'dbpet-kv' }, h('span', null, 'API Key'), h('span', null, verify.keyHint)),
            h('div', { className: 'dbpet-kv' }, h('span', null, '计费网关'), h('span', null, verify.mode === 'plan' ? '套餐订阅' : '按量付费')),
            h('div', { className: 'dbpet-kv' }, h('span', null, '可用模型'), h('span', null, `${verify.reachable.length} / ${verify.total}`)),
            h('div', { className: 'dbpet-kv' }, h('span', null, '套餐'), h('span', null,
              verify.plan && verify.plan.available && verify.plan.plans && verify.plan.plans.length
                ? verify.plan.plans.map((p) => `${p.name || p.key}${p.tier ? ' ' + p.tier : ''}`).join('；')
                : '需 Ark CLI 登录后可见')),
            h('div', { className: 'dbpet-kv' }, h('span', null, '今日消耗'), h('span', null,
              `${today.ark.count} 张 · ${verify.mode === 'plan' ? money(arkList) + '(折算)' : money(arkCash)}`)))))
        : null);
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'doubao-pet', order: 60 }, Pet));
      },
    };
  },
});
