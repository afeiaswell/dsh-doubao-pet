/**
 * 分析 awesome-dsh-plugin 的合并规律（时区换算已修正）。
 *   node tools/merge-forecast.mjs
 *
 * 输出：每天合并数、每次合并会话的起始时刻与规模、FIFO 检验、排期预测。
 */
import { writeFileSync } from 'node:fs';

const H = { 'User-Agent': 'dsh', Accept: 'application/vnd.github+json' };
const REPO = 'awesome-dsh-plugin/awesome-dsh-plugin';
const TZ = 'Asia/Shanghai';
const OUR_CREATED = '2026-11-17T02:52:08Z';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url, { headers: H });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/** 用 Intl 取指定时区的年月日时分，避免 Date 解析时区串味 */
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
function localParts(iso) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

const merged = [];
for (let page = 1; page <= 4; page++) {
  const list = await getJson(`https://api.github.com/repos/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`);
  for (const p of list) {
    if (p.merged_at) merged.push({ number: p.number, created: p.created_at, merged: p.merged_at });
  }
  if (list.length < 100) break;
  await sleep(250);
}

const byDay = new Map();
const byHour = new Map();
for (const m of merged) {
  const { day, hour } = localParts(m.merged);
  byDay.set(day, (byDay.get(day) || 0) + 1);
  byHour.set(hour, (byHour.get(hour) || 0) + 1);
}

// 合并会话：同会话内间隔 < 30 分钟
const sorted = [...merged].sort((a, b) => new Date(a.merged) - new Date(b.merged));
const sessions = [];
for (const m of sorted) {
  const t = new Date(m.merged).getTime();
  const last = sessions[sessions.length - 1];
  if (last && t - last.end <= 30 * 60 * 1000) {
    last.end = t; last.count += 1; last.numbers.push(m.number);
  } else {
    sessions.push({ start: t, end: t, count: 1, numbers: [m.number] });
  }
}

const olderOpen = await (async () => {
  try {
    const res = await fetch(
      `https://api.github.com/search/issues?q=${encodeURIComponent(`repo:${REPO} type:pr state:open created:<${OUR_CREATED}`)}&per_page=1`,
      { headers: H },
    );
    return res.ok ? (await res.json()).total_count : null;
  } catch { return null; }
})();

const report = {
  fetched: merged.length,
  byDay: Object.fromEntries([...byDay].sort()),
  byHour: Object.fromEntries([...byHour].sort((a, b) => a[0] - b[0])),
  sessions: sessions.map((s) => ({
    startLocal: fmt.format(new Date(s.start)),
    endLocal: fmt.format(new Date(s.end)),
    minutes: Math.round((s.end - s.start) / 60000),
    count: s.count,
    minCreated: fmt.format(new Date(Math.min(...s.numbers.map((n) => new Date(merged.find((x) => x.number === n).created).getTime())))),
  })),
  medianWaitHours: (() => {
    const w = sorted.map((m) => (new Date(m.merged) - new Date(m.created)) / 36e5).sort((a, b) => a - b);
    return Math.round(w[Math.floor(w.length / 2)] * 10) / 10;
  })(),
  p90WaitHours: (() => {
    const w = sorted.map((m) => (new Date(m.merged) - new Date(m.created)) / 36e5).sort((a, b) => a - b);
    return Math.round(w[Math.floor(w.length * 0.9)] * 10) / 10;
  })(),
  olderOpen,
};
writeFileSync('art/ai/doubao_plugin/_merge_forecast.json', JSON.stringify(report, null, 2), 'utf8');

console.log(`样本: ${merged.length} 个已合并 PR\n`);
console.log('=== 每天合并数（北京时间）===');
for (const [d, c] of Object.entries(report.byDay)) console.log(`  ${d}  ${'█'.repeat(Math.min(c, 50))} ${c}`);
console.log('\n=== 合并发生在哪个小时（北京时间）===');
for (const [h, c] of Object.entries(report.byHour)) console.log(`  ${String(h).padStart(2, '0')}:00  ${'█'.repeat(Math.min(c, 50))} ${c}`);
console.log('\n=== 合并会话（间隔>30 分钟算新会话）===');
for (const s of report.sessions) console.log(`  ${s.startLocal} → ${s.endLocal.slice(11)}  ${s.count} 个  (跨度 ${s.minutes} 分钟)`);
console.log(`\n等待时长中位 ${report.medianWaitHours}h / P90 ${report.p90WaitHours}h`);
console.log(`比我们早提交且仍未合并: ${report.olderOpen}`);
