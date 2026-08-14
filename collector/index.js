import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MODELS_URL = 'https://opencode.ai/zen/v1/models';
const DOCS_URL = 'https://opencode.ai/docs/zen/';

const SNAPSHOTS_PATH = path.join(ROOT, 'data', 'snapshots.json');
const DATA_OUT_PATH = path.join(ROOT, 'site', 'data.json');

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}

async function fetchHTML(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.text();
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

const TIER_RE = /\s*[(<]\s*([≤>]+\s*[\d,.]+\s*[KkMm]?\s*tokens?)\s*[)>]\s*/;

function stripTier(name) {
  return name.replace(TIER_RE, '').trim();
}

function parsePrice(val) {
  if (val === 'Free') return 0;
  if (val === '-' || val === '') return null;
  return parseFloat(val.replace('$', ''));
}

function parseTierLabel(rawName) {
  const m = rawName.match(TIER_RE);
  return m ? m[1] : null;
}

function todayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function main() {
  console.log('Fetching models list...');
  const modelsData = await fetchJSON(MODELS_URL);
  const activeIds = new Set(modelsData.data.map(m => m.id));
  console.log(`  Found ${activeIds.size} active models`);

  console.log('Fetching docs page...');
  const html = await fetchHTML(DOCS_URL);
  const $ = cheerio.load(html);

  const modelMeta = parseModelsTable($);
  const pricingRows = parsePricingTable($);
  const deprecatedByName = parseDeprecatedTable($);

  console.log(`  Models table: ${Object.keys(modelMeta).length} entries`);
  console.log(`  Pricing rows: ${pricingRows.length}`);
  console.log(`  Deprecated: ${Object.keys(deprecatedByName).length} entries`);

  const deprecatedById = {};
  for (const [display, date] of Object.entries(deprecatedByName)) {
    for (const [id, meta] of Object.entries(modelMeta)) {
      if (meta.display === display) {
        deprecatedById[id] = date;
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

  const date = todayStr();
  const models = [];

  for (const id of [...activeIds].sort()) {
    const meta = modelMeta[id] || {};
    const tiers = pricingById[id] || null;
    const isFree = tiers ? tiers.some(t => t.input === 0 && t.output === 0) : false;
    const depDate = deprecatedById[id] || null;

    models.push({
      id,
      display: meta.display || id,
      endpoint: meta.endpoint || null,
      sdk: meta.sdk || null,
      tiers,
      free: isFree,
      deprecated: depDate,
    });
  }

  const snapshot = { date, models };

  let snapshots = [];
  if (fs.existsSync(SNAPSHOTS_PATH)) {
    snapshots = JSON.parse(fs.readFileSync(SNAPSHOTS_PATH, 'utf-8'));
  }

  if (snapshots.length > 0 && snapshots[snapshots.length - 1].date === date) {
    console.log(`Snapshot for ${date} already exists, skipping.`);
    process.exit(0);
  }

  snapshots.push(snapshot);
  fs.mkdirSync(path.dirname(SNAPSHOTS_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOTS_PATH, JSON.stringify(snapshots, null, 2));
  console.log(`Appended snapshot for ${date}`);

  fs.mkdirSync(path.dirname(DATA_OUT_PATH), { recursive: true });
  fs.writeFileSync(DATA_OUT_PATH, JSON.stringify(snapshot));
  console.log(`Wrote site/data.json`);

  console.log('Snapshot written. Changes detected.');
  process.exit(1);
}

main().catch(err => {
  console.error('Collector failed:', err);
  process.exit(2);
});
