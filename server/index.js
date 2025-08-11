import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fetch from 'node-fetch';

const app = express();
app.use(cors());
app.use(express.json());
// Serve static frontend (project root one level up from server directory)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticRoot = path.join(__dirname, '..');
app.use(express.static(staticRoot));

let db;
(async () => {
  db = await open({ filename: './weather.db', driver: sqlite3.Database });
  await db.exec(`CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);
  await db.exec(`CREATE TABLE IF NOT EXISTS searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      lat REAL,
      lon REAL,
      resolved_label TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);
  await db.exec(`CREATE TABLE IF NOT EXISTS weather_cache (
    key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );`);
  await db.exec(`CREATE TABLE IF NOT EXISTS forecast_cache (
    key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );`);
})();

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Favorites REST
app.get('/api/favorites', async (_req, res) => {
  const rows = await db.all('SELECT * FROM favorites ORDER BY created_at DESC');
  res.json(rows);
});
app.post('/api/favorites', async (req, res) => {
  const { label, lat, lon } = req.body || {};
  if (typeof label !== 'string' || typeof lat !== 'number' || typeof lon !== 'number') {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  await db.run('INSERT INTO favorites(label, lat, lon) VALUES (?,?,?)', label, lat, lon);
  res.status(201).json({ ok: true });
});
app.delete('/api/favorites/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Bad id' });
  await db.run('DELETE FROM favorites WHERE id = ?', id);
  res.json({ ok: true });
});

// Searches log
app.post('/api/searches', async (req, res) => {
  const { query, lat, lon, resolved_label } = req.body || {};
  if (typeof query !== 'string') return res.status(400).json({ error: 'Invalid payload' });
  await db.run('INSERT INTO searches(query, lat, lon, resolved_label) VALUES (?,?,?,?)', query, lat ?? null, lon ?? null, resolved_label ?? null);
  res.status(201).json({ ok: true });
});
app.get('/api/searches', async (_req, res) => {
  const rows = await db.all('SELECT * FROM searches ORDER BY created_at DESC LIMIT 50');
  res.json(rows);
});

// Caching wrappers
const WEATHER_TTL_MS = (process.env.WEATHER_TTL_MIN || 8) * 60 * 1000; // default 8 minutes
const FORECAST_TTL_MS = (process.env.FORECAST_TTL_MIN || 45) * 60 * 1000; // default 45 minutes

function cacheKey(type, params) {
  return `${type}:${Object.entries(params).sort().map(([k,v])=>`${k}=${v}`).join('&')}`;
}

async function getCache(table, key, ttl) {
  const row = await db.get(`SELECT payload, fetched_at FROM ${table} WHERE key = ?`, key);
  if (!row) return null;
  if (Date.now() - row.fetched_at > ttl) return null;
  try { return JSON.parse(row.payload); } catch { return null; }
}
async function setCache(table, key, payload) {
  await db.run(`INSERT OR REPLACE INTO ${table}(key, payload, fetched_at) VALUES (?,?,?)`, key, JSON.stringify(payload), Date.now());
}

async function fetchExternalJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Upstream ${r.status}`);
  return r.json();
}

// Weather cached endpoint (proxy + cache)
app.get('/api/cache/weather', async (req, res) => {
  try {
    const { lat, lon, units = 'metric' } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat & lon required' });
    const key = cacheKey('w', { lat: Number(lat).toFixed(2), lon: Number(lon).toFixed(2), units });
    const cached = await getCache('weather_cache', key, WEATHER_TTL_MS);
    if (cached) return res.json({ cached: true, data: cached });
    const apiKey = process.env.OPENWEATHER_KEY || req.query.apikey; // fallback query for dev
    if (!apiKey) return res.status(500).json({ error: 'Missing API key' });
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=${units}`;
    const data = await fetchExternalJSON(url);
    await setCache('weather_cache', key, data);
    res.json({ cached: false, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Forecast cached endpoint
app.get('/api/cache/forecast', async (req, res) => {
  try {
    const { lat, lon, units = 'metric' } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat & lon required' });
    const key = cacheKey('f', { lat: Number(lat).toFixed(2), lon: Number(lon).toFixed(2), units });
    const cached = await getCache('forecast_cache', key, FORECAST_TTL_MS);
    if (cached) return res.json({ cached: true, data: cached });
    const apiKey = process.env.OPENWEATHER_KEY || req.query.apikey;
    if (!apiKey) return res.status(500).json({ error: 'Missing API key' });
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=${units}`;
    const data = await fetchExternalJSON(url);
    await setCache('forecast_cache', key, data);
    res.json({ cached: false, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Basic cleanup endpoint (optional)
app.post('/api/cache/cleanup', async (_req, res) => {
  try {
    const oldW = Date.now() - WEATHER_TTL_MS * 4;
    const oldF = Date.now() - FORECAST_TTL_MS * 4;
    await db.run('DELETE FROM weather_cache WHERE fetched_at < ?', oldW);
    await db.run('DELETE FROM forecast_cache WHERE fetched_at < ?', oldF);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Finance sample endpoint (placeholder logic)
app.get('/api/finance/overview', async (_req, res) => {
  const fallback = () => ({
    data: [
      { symbol: 'NG=F', name: 'Natural Gas', price: null, changePct: null, weatherNote: 'Cooling demand context' },
      { symbol: 'CL=F', name: 'Crude Oil', price: null, changePct: null, weatherNote: 'Energy demand context' },
      { symbol: 'ZW=F', name: 'Wheat', price: null, changePct: null, weatherNote: 'Crop weather watch' }
    ],
    cached: true,
    notice: 'Fallback static data - live fetch failed',
    ts: Date.now()
  });
  try {
    const symbols = ['CL=F','NG=F','ZW=F'];
    const url = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' + symbols.join(',');
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if(!r.ok) return res.json(fallback());
    const j = await r.json();
    const noteMap = {
      'CL=F':'Energy demand context',
      'NG=F':'Temperature-driven demand',
      'ZW=F':'Crop weather watch'
    };
    const data = (j.quoteResponse?.result||[]).map(q => ({
      symbol: q.symbol,
      name: q.shortName || q.symbol,
      price: q.regularMarketPrice ?? null,
      changePct: q.regularMarketChangePercent != null ? Number(q.regularMarketChangePercent.toFixed(2)) : null,
      weatherNote: noteMap[q.symbol] || 'Weather sensitivity'
    }));
    if(!data.length) return res.json(fallback());
    res.json({ data, ts: Date.now(), source: 'yahoo' });
  } catch (e) {
    res.json(fallback());
  }
});

// News sample endpoint (placeholder logic)
app.get('/api/news/headlines', async (_req, res) => {
  const rssUrl = 'https://climate.nasa.gov/news/rss.xml';
  try {
    const r = await fetch(rssUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if(!r.ok) throw new Error('RSS fetch failed');
    const xml = await r.text();
    // crude parse first 6 <item> titles
    const itemBlocks = xml.split('<item>').slice(1, 7);
    const items = itemBlocks.map((block, i) => {
      const titleMatch = block.match(/<title>(.*?)<\/title>/i);
      let title = titleMatch ? titleMatch[1] : 'Untitled';
      title = title.replace(/<!\[CDATA\[/g,'').replace(/]]>/g,'').trim();
      const linkMatch = block.match(/<link>(.*?)<\/link>/i);
      const link = linkMatch ? linkMatch[1].trim() : null;
      return { id: 'nasa'+i, title, category: 'Climate', source: 'NASA', url: link };
    });
    if(!items.length) throw new Error('No items parsed');
    res.json({ items, ts: Date.now(), source: 'nasa_rss' });
  } catch (e) {
    // fallback static
    res.json({ items: [
      { id: 'f1', title: 'Fallback: Monitoring global climate signals', category: 'Climate' },
      { id: 'f2', title: 'Fallback: Seasonal outlook update pending', category: 'Outlook' },
      { id: 'f3', title: 'Fallback: Severe weather preparedness tips', category: 'Advisory' }
    ], fallback: true, ts: Date.now() });
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log('Server & API listening on http://localhost:' + port));
