let snapshots = null;
let chart = null;

const SNAPSHOTS_URL = 'https://raw.githubusercontent.com/dsillman2000/opencodezen-model-tracker/main/data/snapshots.json';

const GROUPS = [
  { key: 'gpt',     label: 'GPT / OpenAI',       color: '#10b981' },
  { key: 'claude',  label: 'Claude / Anthropic',  color: '#f97316' },
  { key: 'gemini',  label: 'Gemini / Google',     color: '#3b82f6' },
  { key: 'grok',    label: 'Grok / xAI',          color: '#a855f7' },
  { key: 'deepseek',label: 'DeepSeek',            color: '#06b6d4' },
  { key: 'glm',     label: 'GLM / Zhipu',         color: '#ec4899' },
  { key: 'minimax', label: 'MiniMax',             color: '#f59e0b' },
  { key: 'kimi',    label: 'Kimi / Moonshot',     color: '#6366f1' },
  { key: 'qwen',    label: 'Qwen / Alibaba',      color: '#14b8a6' },
  { key: 'free',    label: 'Free',                color: '#6b7280' },
  { key: 'other',   label: 'Other',               color: '#9ca3af' },
];

const GROUP_MAP = Object.fromEntries(GROUPS.map(g => [g.key, g]));

function detectGroup(id) {
  if (id.endsWith('-free')) return 'free';
  if (['big-pickle','mimo-v2.5-free','hy3-free','laguna-s-2.1-free','nemotron-3-ultra-free','nemotron-3.5-lightning-free'].includes(id)) return 'free';
  const prefix = id.split(/[-\d]/).filter(Boolean)[0] || id.split('-')[0];
  if (id.startsWith('gpt')) return 'gpt';
  if (id.startsWith('claude')) return 'claude';
  if (id.startsWith('gemini')) return 'gemini';
  if (id.startsWith('grok')) return 'grok';
  if (id.startsWith('deepseek')) return 'deepseek';
  if (id.startsWith('glm')) return 'glm';
  if (id.startsWith('minimax')) return 'minimax';
  if (id.startsWith('kimi')) return 'kimi';
  if (id.startsWith('qwen')) return 'qwen';
  return 'other';
}

function render() {
  if (!snapshots || snapshots.length === 0) return;

  const dates = snapshots.map(s => s.date);
  const showOutput = document.getElementById('show-output').checked;
  const enabledGroups = new Set(
    GROUPS.filter(g => document.getElementById(`cb-${g.key}`).checked).map(g => g.key)
  );

  const allIds = [...new Set(snapshots.flatMap(s => s.models.map(m => m.id)))].sort();
  const series = [];
  const legendData = [];

  for (const id of allIds) {
    const group = detectGroup(id);
    if (!enabledGroups.has(group)) continue;
    const grp = GROUP_MAP[group];

    let display = id;
    const snapModel = snapshots.find(s => s.models.find(m => m.id === id))?.models.find(m => m.id === id);
    if (snapModel) display = snapModel.display;

    const isFree = snapshots.some(s => s.models.find(m => m.id === id)?.free);

    const datesIn = [];
    const pricesIn = [];
    const pricesOut = [];

    for (const snap of snapshots) {
      const m = snap.models.find(mm => mm.id === id);
      if (!m || !m.tiers || m.tiers.length === 0) continue;
      const t = m.tiers[0];
      if (t.input === null || t.input === undefined) continue;
      datesIn.push(snap.date);
      pricesIn.push(t.input);
      if (showOutput) pricesOut.push(t.output !== null && t.output !== undefined ? t.output : null);
    }

    if (datesIn.length === 0) continue;

    const lineStyleIn = isFree ? { type: 'dotted', width: 1.5 } : { width: 1.5 };
    const lineStyleOut = { type: 'dashed', width: 1 };

    series.push({
      name: `${display} (in)`,
      type: 'line',
      data: datesIn.map((d, i) => [d, pricesIn[i]]),
      connectNulls: false,
      symbol: 'none',
      lineStyle: lineStyleIn,
      itemStyle: { color: grp.color },
      emphasis: { focus: 'series' },
    });
    legendData.push(`${display} (in)`);

    if (showOutput && pricesOut.some(v => v !== null)) {
      series.push({
        name: `${display} (out)`,
        type: 'line',
        data: datesIn.map((d, i) => [d, pricesOut[i]]),
        connectNulls: true,
        symbol: 'none',
        lineStyle: lineStyleOut,
        itemStyle: { color: grp.color },
        emphasis: { focus: 'series' },
      });
      legendData.push(`${display} (out)`);
    }
  }

  const option = {
    backgroundColor: '#111827',
    title: {
      text: 'OpenCode Zen — Model Pricing Timeline',
      left: 'center',
      top: 6,
      textStyle: { fontSize: 16, color: '#e5e7eb', fontWeight: 500 },
    },
    tooltip: {
      trigger: 'axis',
      formatter: function (params) {
        const date = params[0].axisValue;
        let html = `<strong>${date}</strong><br>`;
        for (const p of params) {
          if (p.value[1] == null) continue;
          html += `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:4px"></span> ${p.seriesName}: <strong>$${Number(p.value[1]).toFixed(4)}</strong><br>`;
        }
        return html;
      },
    },
    legend: {
      type: 'scroll',
      orient: 'vertical',
      right: 8,
      top: 50,
      bottom: 20,
      textStyle: { fontSize: 10, color: '#9ca3af' },
      pageIconColor: '#6b7280',
      pageIconInactiveColor: '#374151',
      pageIconSize: 10,
      selector: [
        { type: 'all', title: 'All' },
        { type: 'inverse', title: 'Inv' },
      ],
    },
    grid: {
      left: 65,
      right: 210,
      bottom: 40,
      top: 55,
    },
    xAxis: {
      type: 'time',
      axisLabel: { color: '#9ca3af', fontSize: 11 },
      axisLine: { lineStyle: { color: '#374151' } },
      splitLine: { lineStyle: { color: '#1f2937' } },
    },
    yAxis: {
      type: 'log',
      min: 0.01,
      axisLabel: {
        color: '#9ca3af',
        fontSize: 11,
        formatter: (v) => v < 1 ? `$${v.toFixed(3)}` : `$${v.toFixed(0)}`,
      },
      axisLine: { lineStyle: { color: '#374151' } },
      splitLine: { lineStyle: { color: '#1f2937' } },
      name: 'Price / 1M tokens (USD, log scale)',
      nameTextStyle: { color: '#6b7280', fontSize: 11 },
    },
    dataZoom: [
      { type: 'inside', orient: 'horizontal' },
      { type: 'slider', orient: 'horizontal', bottom: 0, height: 24, borderColor: '#374151' },
    ],
    series,
    animationDuration: 400,
  };

  chart.setOption(option, true);
}

async function init() {
  chart = echarts.init(document.getElementById('main'), 'dark');

  try {
    const res = await fetch(SNAPSHOTS_URL);
    snapshots = await res.json();
  } catch {
    try {
      const res = await fetch('./data.json');
      const latest = await res.json();
      snapshots = [latest];
    } catch {
      document.getElementById('main').innerHTML = `<div class="error">Could not load data. Run the collector first (npm run collect).</div>`;
      return;
    }
  }

  render();
}

document.getElementById('show-output').addEventListener('change', render);

for (const g of GROUPS) {
  document.getElementById(`cb-${g.key}`).addEventListener('change', render);
}

document.getElementById('select-all').addEventListener('click', () => {
  for (const g of GROUPS) document.getElementById(`cb-${g.key}`).checked = true;
  render();
});

document.getElementById('select-none').addEventListener('click', () => {
  for (const g of GROUPS) document.getElementById(`cb-${g.key}`).checked = false;
  render();
});

window.addEventListener('resize', () => chart && chart.resize());

const lastUpdateEl = document.getElementById('last-update');
if (lastUpdateEl) {
  try {
    fetch(SNAPSHOTS_URL).then(r => r.json()).then(d => {
      const last = d[d.length - 1];
      if (last) lastUpdateEl.textContent = `Last updated: ${last.date}`;
    }).catch(() => {});
  } catch {}
}

init();
