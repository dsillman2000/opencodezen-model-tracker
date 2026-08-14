import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname);

const WAYBACK_API = 'https://web.archive.org/__wb/calendarcaptures/2';
const WAYBACK_WEB = 'https://web.archive.org/web';
const DOCS_URL = 'https://opencode.ai/docs/zen/';
const MODELS_URL = 'https://opencode.ai/zen/v1/models';
const ENCODED_DOCS = encodeURIComponent(DOCS_URL);
const ENCODED_MODELS = encodeURIComponent(MODELS_URL);

const SNAPSHOTS_PATH = path.join(ROOT, 'data', 'snapshots.json');
const RATE_LIMIT_MS = 1500;

const TIER_RE = /\s*[(<]\s*([≤>]+\s*[\d,.]+\s*[KkMm]?\s*tokens?)\s*[)>]\s*/;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchJSON(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'opencodezen-backfill/1.0' } });
      if (res.ok) return { ok: true, data: await res.json() };
      if (res.status === 429) { await sleep((i + 1) * 3000); continue; }
      return { ok: false, status: res.status };
    } catch (e) {
      if (i < retries - 1) await sleep(2000);
      else return { ok: false, error: e.message };
    }
  }
  return { ok: false, error: 'max retries' };
}

async function fetchText(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'opencodezen-backfill/1.0' } });
      if (res.ok) return { ok: true, text: await res.text() };
      if (res.status === 429) { await sleep((i + 1) * 3000); continue; }
      return { ok: false, status: res.status };
    } catch (e) {
      if (i < retries - 1) await sleep(2000);
      else return { ok: false, error: e.message };
    }
  }
  return { ok: false, error: 'max retries' };
}

function monthDayToDate(year, mmdd) {
  const s = String(mmdd).padStart(4, '0');
  const m = parseInt(s.slice(0, 2), 10) - 1;
  const d = parseInt(s.slice(2, 4), 10);
  const dt = new Date(Date.UTC(year, m, d));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return { iso: `${yyyy}-${mm}-${dd}`, yyyymmdd: `${yyyy}${mm}${dd}` };
}

function parseModelsTable($) {
  const map = {};
  const tables = $('table');
  for (let i = 0; i < tables.length; i++) {
    const headers = $(tables[i]).find('thead th').map((_, th) => $(th).text().trim()).get();
    if (!headers.includes('Model ID')) continue;
    $(tables[i]).find('tbody tr').each((_, row) => {
      const cols = $(row).find('td');
      const display = $(cols[0]).text().trim();
      const id = $(cols[1]).text().trim();
      const endpoint = $(cols[2]).find('code').length ? $(cols[2]).find('code').text().trim() : $(cols[2]).text().trim();
      const sdk = $(cols[3]).find('code').length ? $(cols[3]).find('code').text().trim() : $(cols[3]).text().trim();
      map[id] = { display, endpoint, sdk };
    });
    break;
  }
  return map;
}

function parsePricingTable($) {
  const rows = [];
  const tables = $('table');
  for (let i = 0; i < tables.length; i++) {
    const headers = $(tables[i]).find('thead th').map((_, th) => $(th).text().trim()).get();
    if (!headers.includes('Cached Write') || !headers.includes('Input') || !headers.includes('Output')) continue;
    $(tables[i]).find('tbody tr').each((_, row) => {
      const cols = $(row).find('td');
      const rawName = $(cols[0]).text().trim();
      const input = $(cols[1]).text().trim();
      const output = $(cols[2]).text().trim();
      const cachedRead = $(cols[3]).text().trim();
      const cachedWrite = $(cols[4]).text().trim();
      rows.push({ rawName, input, output, cachedRead, cachedWrite });
    });
    break;
  }
  return rows;
}

function parseDeprecatedTable($) {
  const map = {};
  const tables = $('table');
  for (let i = 0; i < tables.length; i++) {
    const headers = $(tables[i]).find('thead th').map((_, th) => $(th).text().trim()).get();
    if (!headers.includes('Deprecation date')) continue;
    $(tables[i]).find('tbody tr').each((_, row) => {
      const cols = $(row).find('td');
      const display = $(cols[0]).text().trim();
      const date = $(cols[1]).text().trim();
      map[display] = date;
    });
    break;
  }
  return map;
}

function stripTier(name) {
  return name.replace(TIER_RE, '').trim();
}

function parsePrice(val) {
  if (val === 'Free') return 0;
  if (val === '-' || val === '') return null;
  if (val === 'Soon') return null;
  return parseFloat(val.replace('$', ''));
}

function parseTierLabel(rawName) {
  const m = rawName.match(TIER_RE);
  return m ? m[1] : null;
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function detectTableFormat($) {
  const tables = $('table');
  for (let i = 0; i < tables.length; i++) {
    const headers = $(tables[i]).find('thead th').map((_, th) => $(th).text().trim()).get();
    if (headers.includes('Model ID')) return 'full';
    if (headers.length === 3 && headers[0] === 'Model' && headers[1] === 'Input' && headers[2] === 'Output') return 'simple';
  }
  return 'unknown';
}

function parseSimpleTable($) {
  const models = [];
  const tables = $('table');
  for (let i = 0; i < tables.length; i++) {
    const headers = $(tables[i]).find('thead th').map((_, th) => $(th).text().trim()).get();
    if (headers.length !== 3 || headers[0] !== 'Model' || headers[1] !== 'Input' || headers[2] !== 'Output') continue;
    $(tables[i]).find('tbody tr').each((_, row) => {
      const cols = $(row).find('td');
      const display = $(cols[0]).text().trim();
      const input = parsePrice($(cols[1]).text().trim());
      const output = parsePrice($(cols[2]).text().trim());
      if (input === null && output === null) return;
      models.push({
        id: slugify(display),
        display,
        endpoint: null,
        sdk: null,
        tiers: [{ input, output, cachedRead: null, cachedWrite: null }],
        free: input === 0 && output === 0,
        deprecated: null,
      });
    });
    break;
  }
  return models;
}

async function getYearlyCaptureDays(year) {
  const url = `${WAYBACK_API}?url=${ENCODED_DOCS}&date=${year}&groupby=day`;
  const result = await fetchJSON(url);
  if (!result.ok) {
    console.warn(`  [${year}] Calendar API failed: ${result.status || result.error}`);
    return [];
  }
  const entries = result.data?.items || (Array.isArray(result.data) ? result.data : []);
  return entries.filter(([_, status, count]) => status === 200 && count > 0);
}

async function getDayTimestamps(year, yyyymmdd) {
  const url = `${WAYBACK_API}?url=${ENCODED_DOCS}&date=${yyyymmdd}`;
  const result = await fetchJSON(url);
  if (!result.ok) return [];
  const items = result.data?.items || [];
  return items.filter(([_, status]) => status === 200).map(([ts]) => ts);
}

async function getModelsApiTimestamps(year, yyyymmdd) {
  const url = `${WAYBACK_API}?url=${ENCODED_MODELS}&date=${yyyymmdd}`;
  const result = await fetchJSON(url);
  if (!result.ok) return [];
  const items = result.data?.items || [];
  return items.filter(([_, status]) => status === 200).map(([ts]) => ts);
}

function buildArchiveUrl(timestamp, targetUrl) {
  const ts = String(timestamp);
  return `${WAYBACK_WEB}/${ts}/${targetUrl}`;
}

function buildSnapshot(date, html, modelsJson) {
  const $ = cheerio.load(html);
  const format = detectTableFormat($);

  if (format === 'simple') {
    const models = parseSimpleTable($);
    if (models.length === 0) return { ok: false, reason: 'simple table parse returned no models' };
    return { ok: true, snapshot: { date, models } };
  }

  if (format !== 'full') {
    return { ok: false, reason: `unrecognized table format` };
  }

  const modelMeta = parseModelsTable($);
  const pricingRows = parsePricingTable($);
  const deprecatedByName = parseDeprecatedTable($);

  if (Object.keys(modelMeta).length === 0) {
    return { ok: false, reason: 'no model metadata table found' };
  }
  if (pricingRows.length === 0) {
    return { ok: false, reason: 'no pricing table found' };
  }

  let activeIds;
  if (modelsJson && modelsJson.data && Array.isArray(modelsJson.data)) {
    activeIds = new Set(modelsJson.data.map(m => m.id));
  } else {
    activeIds = new Set(Object.keys(modelMeta));
  }

  const deprecatedById = {};
  for (const [display, depDate] of Object.entries(deprecatedByName)) {
    for (const [id, meta] of Object.entries(modelMeta)) {
      if (meta.display === display) {
        deprecatedById[id] = depDate;
        break;
      }
    }
  }

  const pricingById = {};
  for (const row of pricingRows) {
    const baseName = stripTier(row.rawName);
    const tier = parseTierLabel(row.rawName);
    for (const [id, meta] of Object.entries(modelMeta)) {
      if (meta.display === baseName) {
        if (!pricingById[id]) pricingById[id] = [];
        const input = parsePrice(row.input);
        const output = parsePrice(row.output);
        const cachedRead = parsePrice(row.cachedRead);
        const cachedWrite = parsePrice(row.cachedWrite);
        if (!tier) {
          pricingById[id].push({ input, output, cachedRead, cachedWrite });
        } else {
          pricingById[id].push({ label: tier, input, output, cachedRead, cachedWrite });
        }
        break;
      }
    }
  }

  const models = [];
  for (const id of [...activeIds].sort()) {
    const meta = modelMeta[id];
    if (!meta) continue;
    const tiers = pricingById[id] || null;
    const isFree = tiers ? tiers.some(t => t.input === 0 && t.output === 0) : false;
    const depDate = deprecatedById[id] || null;
    models.push({
      id,
      display: meta.display,
      endpoint: meta.endpoint || null,
      sdk: meta.sdk || null,
      tiers,
      free: isFree,
      deprecated: depDate,
    });
  }

  if (models.length === 0) {
    return { ok: false, reason: 'no models matched after merging tables' };
  }

  return { ok: true, snapshot: { date, models } };
}

async function processDate(isoDate, yyyymmdd, existingDates) {
  if (existingDates.has(isoDate)) {
    console.log(`  Skipping ${isoDate} — already in snapshots`);
    return null;
  }

  const docsTimestamps = await getDayTimestamps(yyyymmdd.slice(0, 4), yyyymmdd);
  await sleep(RATE_LIMIT_MS);

  if (docsTimestamps.length === 0) {
    console.warn(`  ${isoDate}: no docs snapshots with status 200, skipping`);
    return null;
  }

  const bestDocTs = Math.max(...docsTimestamps);
  const bestDocTsStr = `${yyyymmdd}${String(bestDocTs).padStart(6, '0')}`;
  const docUrl = buildArchiveUrl(bestDocTsStr, DOCS_URL);

  console.log(`  ${isoDate}: fetching docs (${bestDocTsStr})...`);
  const docRes = await fetchText(docUrl);
  await sleep(RATE_LIMIT_MS);

  if (!docRes.ok) {
    console.warn(`  ${isoDate}: docs fetch failed (${docRes.status || docRes.error}), skipping`);
    return null;
  }

  let modelsJson = null;
  const modelsTimestamps = await getModelsApiTimestamps(yyyymmdd.slice(0, 4), yyyymmdd);
  await sleep(RATE_LIMIT_MS);

  if (modelsTimestamps.length > 0) {
    const bestModelTs = Math.max(...modelsTimestamps);
    const bestModelTsStr = `${yyyymmdd}${String(bestModelTs).padStart(6, '0')}`;
    const modelUrl = buildArchiveUrl(bestModelTsStr, MODELS_URL);
    console.log(`  ${isoDate}: fetching models API (${bestModelTsStr})...`);
    const modelRes = await fetchJSON(modelUrl);
    await sleep(RATE_LIMIT_MS);
    if (modelRes.ok) {
      modelsJson = modelRes.data;
    } else {
      console.warn(`  ${isoDate}: models API unavailable, using docs table IDs`);
    }
  } else {
    console.log(`  ${isoDate}: no models API snapshots, using docs table IDs`);
  }

  const result = buildSnapshot(isoDate, docRes.text, modelsJson);

  if (!result.ok) {
    console.warn(`  ${isoDate}: parse failed — ${result.reason}, skipping`);
    return null;
  }

  return result.snapshot;
}

function loadExistingSnapshots() {
  if (!fs.existsSync(SNAPSHOTS_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOTS_PATH, 'utf-8'));
  } catch {
    console.warn('Warning: could not parse existing snapshots.json, starting fresh');
    return [];
  }
}

async function main() {
  console.log('OpenCode Zen — Wayback Machine Backfill\n');

  const existingSnapshots = loadExistingSnapshots();
  const existingDates = new Set(existingSnapshots.map(s => s.date));
  console.log(`Existing snapshots: ${existingSnapshots.length} (${[...existingDates].sort().join(', ')})\n`);

  const currentYear = new Date().getFullYear();
  const startYear = 2026;

  let added = 0;
  let skipped = 0;
  let failed = 0;

  for (let year = currentYear; year >= startYear; year--) {
    console.log(`\n=== Probing ${year} ===`);
    const days = await getYearlyCaptureDays(year);
    await sleep(RATE_LIMIT_MS);

    if (days.length === 0) {
      console.log(`  No captures found for ${year}`);
      continue;
    }

    days.sort((a, b) => b[0] - a[0]);
    console.log(`  Found ${days.length} days with captures`);

    const now = new Date();
    for (const [mmdd, status, count] of days) {
      const { iso, yyyymmdd } = monthDayToDate(year, mmdd);

      const snapDate = new Date(yyyymmdd.slice(0, 4) + '-' + yyyymmdd.slice(4, 6) + '-' + yyyymmdd.slice(6, 8));
      if (snapDate > now) continue;

      if (existingDates.has(iso)) {
        skipped++;
        continue;
      }

      console.log(`\n  Processing ${iso} (${count} snapshot(s))...`);
      const snapshot = await processDate(iso, yyyymmdd, existingDates);

      if (snapshot) {
        existingSnapshots.push(snapshot);
        existingDates.add(iso);
        fs.writeFileSync(SNAPSHOTS_PATH, JSON.stringify(existingSnapshots, null, 2));
        console.log(`  ✓ ${iso} saved (${snapshot.models.length} models)`);
        added++;
      } else {
        failed++;
      }
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`  Added: ${added}`);
  console.log(`  Skipped (already present): ${skipped}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total snapshots: ${existingSnapshots.length}`);
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
