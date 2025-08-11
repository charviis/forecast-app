import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import fetch from 'node-fetch';

const app = express();
app.use(cors());
app.use(express.json());
// Serve static frontend (project root one level up from server directory)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const staticRoot = path.join(__dirname, '..');
app.use(express.static(staticRoot));

// Initialize sqlite3 without external 'sqlite' wrapper
const dbFile = path.join(__dirname, 'weather.db');
const rawDb = new sqlite3.Database(dbFile);
const runAsync = (sql, params=[]) => new Promise((resolve, reject) => rawDb.run(sql, params, function(err){ if(err) reject(err); else resolve(this); }));
const allAsync = (sql, params=[]) => new Promise((resolve, reject) => rawDb.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));
const getAsync = (sql, params=[]) => new Promise((resolve, reject) => rawDb.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
const execAsync = (sql) => new Promise((resolve, reject) => rawDb.exec(sql, err => err ? reject(err) : resolve()));

const dbReady = (async () => {
  await execAsync(`CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);
  await execAsync(`CREATE TABLE IF NOT EXISTS searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      lat REAL,
      lon REAL,
      resolved_label TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );`);
  await execAsync(`CREATE TABLE IF NOT EXISTS weather_cache (
    key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );`);
  await execAsync(`CREATE TABLE IF NOT EXISTS forecast_cache (
    key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );`);
})();

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Favorites REST
app.get('/api/favorites', async (_req, res) => {
  await dbReady;  
  const rows = await allAsync('SELECT * FROM favorites ORDER BY created_at DESC');
  res.json(rows);
});
app.post('/api/favorites', async (req, res) => {
  await dbReady;
  const { label, lat, lon } = req.body || {};
  if (typeof label !== 'string' || typeof lat !== 'number' || typeof lon !== 'number') {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  await runAsync('INSERT INTO favorites(label, lat, lon) VALUES (?,?,?)', [label, lat, lon]);
  res.status(201).json({ ok: true });
});
app.delete('/api/favorites/:id', async (req, res) => {
  await dbReady;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Bad id' });
  await runAsync('DELETE FROM favorites WHERE id = ?', [id]);
  res.json({ ok: true });
});

// Searches log
app.post('/api/searches', async (req, res) => {
  await dbReady;
  const { query, lat, lon, resolved_label } = req.body || {};
  if (typeof query !== 'string') return res.status(400).json({ error: 'Invalid payload' });
  await runAsync('INSERT INTO searches(query, lat, lon, resolved_label) VALUES (?,?,?,?)', [query, lat ?? null, lon ?? null, resolved_label ?? null]);
  res.status(201).json({ ok: true });
});
app.get('/api/searches', async (_req, res) => {
  await dbReady;
  const rows = await allAsync('SELECT * FROM searches ORDER BY created_at DESC LIMIT 50');
  res.json(rows);
});

// Caching wrappers
const WEATHER_TTL_MS = (process.env.WEATHER_TTL_MIN || 8) * 60 * 1000; // default 8 minutes
const FORECAST_TTL_MS = (process.env.FORECAST_TTL_MIN || 45) * 60 * 1000; // default 45 minutes

function cacheKey(type, params) {
  return `${type}:${Object.entries(params).sort().map(([k,v])=>`${k}=${v}`).join('&')}`;
}

async function getCache(table, key, ttl) {
  await dbReady;
  const row = await getAsync(`SELECT payload, fetched_at FROM ${table} WHERE key = ?`, [key]);
  if (!row) return null;
  if (Date.now() - row.fetched_at > ttl) return null;
  try { return JSON.parse(row.payload); } catch { return null; }
}
async function setCache(table, key, payload) {
  await dbReady;
  await runAsync(`INSERT OR REPLACE INTO ${table}(key, payload, fetched_at) VALUES (?,?,?)`, [key, JSON.stringify(payload), Date.now()]);
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
  await runAsync('DELETE FROM weather_cache WHERE fetched_at < ?', [oldW]);
  await runAsync('DELETE FROM forecast_cache WHERE fetched_at < ?', [oldF]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Finance sample endpoint (placeholder logic)
app.get('/api/finance/overview', async (_req, res) => {
  const fallback = () => ({
    data: [
  { symbol: 'NG=F', name: 'Natural Gas', price: null, changePct: null, changeAbs:null, high:null, low:null, currency:'', marketTime:null, weatherNote: 'Cooling demand context' },
  { symbol: 'CL=F', name: 'Crude Oil', price: null, changePct: null, changeAbs:null, high:null, low:null, currency:'', marketTime:null, weatherNote: 'Energy demand context' },
  { symbol: 'ZW=F', name: 'Wheat', price: null, changePct: null, changeAbs:null, high:null, low:null, currency:'', marketTime:null, weatherNote: 'Crop weather watch' }
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
      changeAbs: q.regularMarketChange != null ? Number(q.regularMarketChange.toFixed(3)) : null,
      high: q.regularMarketDayHigh ?? null,
      low: q.regularMarketDayLow ?? null,
      currency: q.currency || '',
      marketTime: q.regularMarketTime ? q.regularMarketTime * 1000 : null,
      weatherNote: noteMap[q.symbol] || 'Weather sensitivity'
    }));
    if(!data.length) return res.json(fallback());
    res.json({ data, ts: Date.now(), source: 'yahoo' });
  } catch (e) {
    res.json(fallback());
  }
});

// Finance history endpoint (Yahoo Finance chart API proxy)
app.get('/api/finance/history', async (req, res) => {
  try {
    const { symbol, range = '1d' } = req.query;
    if(!symbol) return res.status(400).json({ error: 'symbol required'});
    const allowed = new Set(['1d','5d','1mo']);
    const rng = allowed.has(range) ? range : '1d';
    const intervalMap = { '1d':'5m', '5d':'15m', '1mo':'1d' };
    const interval = intervalMap[rng] || '5m';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${rng}&interval=${interval}`;
    const r = await fetch(url, { headers:{'User-Agent':'Mozilla/5.0'} });
    if(!r.ok) return res.status(502).json({ error:'Upstream '+r.status });
    const j = await r.json();
    const result = j.chart?.result?.[0];
    if(!result) return res.status(500).json({ error:'No data' });
    const timestamps = result.timestamp || [];
    const indicators = result.indicators?.quote?.[0] || {};
    const candles = timestamps.map((t,i)=>({
      t: (t*1000),
      o: indicators.open?.[i] ?? null,
      h: indicators.high?.[i] ?? null,
      l: indicators.low?.[i] ?? null,
      c: indicators.close?.[i] ?? null,
      v: indicators.volume?.[i] ?? null
    })).filter(c=>c.c!=null);
    res.json({ symbol, range: rng, interval, candles, meta: { currency: result.meta?.currency, exchange: result.meta?.exchangeName } });
  } catch(e){
    res.status(500).json({ error:e.message });
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
      const pubMatch = block.match(/<pubDate>(.*?)<\/pubDate>/i);
      let pubDate = null;
      if(pubMatch){
        const d = new Date(pubMatch[1]);
        if(!isNaN(d.getTime())) pubDate = d.getTime();
      }
      return { id: 'nasa'+i, title, category: 'Climate', source: 'NASA', url: link, pubDate };
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

// Aggregated multi-feed news endpoint
app.get('/api/news/aggregate', async (_req, res) => {
  const feeds = [
    { id:'nasa', url:'https://climate.nasa.gov/news/rss.xml', source:'NASA Climate' },
    { id:'noaa', url:'https://www.noaa.gov/rss.xml', source:'NOAA' },
    { id:'metoffice', url:'https://www.metoffice.gov.uk/rss/weather/featured-news', source:'Met Office' }
  ];
  const MAX_PER_FEED = 8;
  const results = [];
  await Promise.all(feeds.map(async f => {
    try {
      const r = await fetch(f.url, { headers:{'User-Agent':'Mozilla/5.0'} });
      if(!r.ok) return;
      const xml = await r.text();
      const items = xml.split('<item>').slice(1, MAX_PER_FEED+1).map((block,i) => {
        const titleMatch = block.match(/<title>(.*?)<\/title>/i);
        let title = titleMatch ? titleMatch[1] : 'Untitled';
        title = title.replace(/<!\[CDATA\[/g,'').replace(/]]>/g,'').trim();
        const linkMatch = block.match(/<link>(.*?)<\/link>/i);
        const link = linkMatch ? linkMatch[1].trim() : null;
        const catMatch = block.match(/<category>(.*?)<\/category>/i);
        let category = catMatch ? catMatch[1].replace(/<!\[CDATA\[/g,'').replace(/]]>/g,'').trim() : 'General';
        // simple category normalization
        category = /storm|hurricane|cyclone/i.test(category) ? 'Storms' :
                   /heat|temperature|warm/i.test(category) ? 'Heat' :
                   /flood|rain|precip/i.test(category) ? 'Flooding' :
                   /climate|carbon|emission/i.test(category) ? 'Climate' : category;
        const pubMatch = block.match(/<pubDate>(.*?)<\/pubDate>/i);
        let pubDate = null; if(pubMatch){ const d = new Date(pubMatch[1]); if(!isNaN(d)) pubDate = d.getTime(); }
        return { id:`${f.id}-${i}`, title, url:link, category, source:f.source, pubDate };
      });
      results.push(...items);
    } catch(e){ /* ignore individual feed errors */ }
  }));
  const filtered = results.filter(r=>r.title && r.url);
  filtered.sort((a,b)=>(b.pubDate||0)-(a.pubDate||0));
  res.json({ items: filtered.slice(0,40), sources: feeds.map(f=>f.source), ts: Date.now() });
});

// === Integrated Finance (RapidAPI Yahoo) Endpoints ===
const YF_API_KEY = process.env.YF_API_KEY;
const YF_API_HOST = process.env.YF_API_HOST || 'yh-finance.p.rapidapi.com';
const YF_FUND_HOST = process.env.YF_FUND_HOST || 'apidojo-yahoo-finance-v1.p.rapidapi.com';
const YF_MARKET_HOST = process.env.YF_MARKET_HOST || 'apidojo-yahoo-finance-v1.p.rapidapi.com';
if(!YF_API_KEY){
  console.warn('[server] YF_API_KEY missing: /api/quotes* endpoints will return 500');
}
const finCache = new Map(); // key -> { data, ts }
function finGet(key, ttl){ const hit = finCache.get(key); if(!hit) return null; if(Date.now()-hit.ts>ttl){ finCache.delete(key); return null; } return hit.data; }
function finSet(key,data){ finCache.set(key,{ data, ts:Date.now() }); }
const FUND_TTL = 6 * 60 * 60 * 1000; // 6 hours fundamentals cache
async function rapid(path, params){
  if(!YF_API_KEY) throw new Error('missing finance API key');
  const url = new URL(`https://${YF_API_HOST}${path}`);
  Object.entries(params||{}).forEach(([k,v])=> url.searchParams.set(k,v));
  const r = await fetch(url.toString(), { headers:{ 'X-RapidAPI-Key': YF_API_KEY, 'X-RapidAPI-Host': YF_API_HOST } });
  if(!r.ok) throw new Error('Upstream '+r.status);
  return r.json();
}
async function rapidFund(path, params){
  if(!YF_API_KEY) throw new Error('missing finance API key');
  const url = new URL(`https://${YF_FUND_HOST}${path}`);
  Object.entries(params||{}).forEach(([k,v])=> url.searchParams.set(k,v));
  const r = await fetch(url.toString(), { headers:{ 'X-RapidAPI-Key': YF_API_KEY, 'X-RapidAPI-Host': YF_FUND_HOST } });
  if(!r.ok) throw new Error('Fundamentals upstream '+r.status);
  return r.json();
}
async function rapidMarket(path, params){
  if(!YF_API_KEY) throw new Error('missing finance API key');
  const url = new URL(`https://${YF_MARKET_HOST}${path}`);
  Object.entries(params||{}).forEach(([k,v])=> url.searchParams.set(k,v));
  const r = await fetch(url.toString(), { headers:{ 'X-RapidAPI-Key': YF_API_KEY, 'X-RapidAPI-Host': YF_MARKET_HOST } });
  if(!r.ok) throw new Error('Market upstream '+r.status);
  return r.json();
}

// --- Fallback (public Yahoo endpoints, no key) ---
async function yahooPublicQuotes(symbols){
  const hosts = ['https://query1.finance.yahoo.com','https://query2.finance.yahoo.com'];
  const path = '/v7/finance/quote?symbols='+encodeURIComponent(symbols);
  let lastErr;
  for(const h of hosts){
    try {
      const r = await fetch(h+path, { headers:{ 'User-Agent':'Mozilla/5.0','Accept':'application/json,text/javascript,*/*;q=0.01','Pragma':'no-cache','Cache-Control':'no-cache' } });
      if(!r.ok){ lastErr = new Error('public quote upstream '+r.status); continue; }
      return await r.json();
    } catch(e){ lastErr = e; }
  }
  throw lastErr || new Error('public quote failed');
}
async function yahooPublicChart(symbol, range, interval){
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const r = await fetch(url, { headers:{ 'User-Agent':'Mozilla/5.0' } });
  if(!r.ok) throw new Error('public chart upstream '+r.status);
  return r.json();
}

// GET /api/quotes?symbols=AAPL,MSFT
app.get('/api/quotes', async (req,res)=>{
  let symbols = (req.query.symbols||'').toString().replace(/\s+/g,'');
  // Fallback to default watchlist if none provided so client never hard-errors
  const defaultList = 'AAPL,MSFT,GOOGL,AMZN,TSLA';
  let defaulted = false;
  if(!symbols){ symbols = defaultList; defaulted = true; }
  const cacheKey = 'q:'+symbols;
  const cached = finGet(cacheKey, 10000);
  if(cached) return res.json({ cached:true, ...cached });
  let result=[]; let source='public-first';
  console.log('[quotes] attempt public-first for', symbols);
  // Try public first (often works without key)
  try {
    const data = await yahooPublicQuotes(symbols);
    result = (data.quoteResponse?.result||[]).map(q=>({
      symbol:q.symbol,
      name:q.shortName||q.longName||q.symbol,
      price:q.regularMarketPrice??null,
      change:q.regularMarketChange??null,
      changePct:q.regularMarketChangePercent!=null?Number(q.regularMarketChangePercent.toFixed(2)):null,
      high:q.regularMarketDayHigh??null,
      low:q.regularMarketDayLow??null,
      currency:q.currency||'',
      marketTime:q.regularMarketTime? q.regularMarketTime*1000 : null,
      source:'public'
    }));
  } catch(pubErr){
    console.warn('[quotes] public fetch failed -> rapid attempt', pubErr.message);
    try {
      const data = await rapid('/market/v2/get-quotes', { symbols });
      result = (data.quoteResponse?.result||[]).map(q=>({
        symbol:q.symbol,
        name:q.shortName||q.longName||q.symbol,
        price:q.regularMarketPrice??null,
        change:q.regularMarketChange??null,
        changePct:q.regularMarketChangePercent!=null?Number(q.regularMarketChangePercent.toFixed(2)):null,
        high:q.regularMarketDayHigh??null,
        low:q.regularMarketDayLow??null,
        currency:q.currency||'',
        marketTime:q.regularMarketTime? q.regularMarketTime*1000 : null,
        source:'rapid'
      }));
      source='rapid';
    } catch(rapidErr){
      console.warn('[quotes] rapid failed, building placeholders', rapidErr.message);
      result = symbols.split(',').filter(Boolean).map(sym=>({ symbol:sym, name:sym, price:null, change:null, changePct:null, high:null, low:null, currency:'', marketTime:null, source:'placeholder', notice:'unavailable' }));
      source='placeholder';
    }
  }
  try { finSet(cacheKey,{ data: result }); } catch{}
  console.log('[quotes] final source', source, 'count', Array.isArray(result)?result.length:0);
  res.json({ cached:false, data: result, source, ts:Date.now(), defaulted });
});

// GET /api/quotes/history?symbol=AAPL&range=1d&interval=5m
app.get('/api/quotes/history', async (req,res)=>{
  try {
    const { symbol, range='1d', interval } = req.query;
    if(!symbol) return res.status(400).json({ error:'symbol required' });
    const rngAllowed = ['1d','5d','1mo','3mo','6mo','1y'];
    const rng = rngAllowed.includes(range) ? range : '1d';
    const intDefaults = { '1d':'5m','5d':'15m','1mo':'1d','3mo':'1d','6mo':'1d','1y':'1d' };
    const iv = interval || intDefaults[rng] || '5m';
    const key = `hist:${symbol}:${rng}:${iv}`;
    const cached = finGet(key, 60000);
    if(cached) return res.json({ cached:true, ...cached });
    let result, payload;
    try {
      const data = await rapid('/stock/v3/get-chart', { symbol, range:rng, interval:iv, region:'US' });
      result = data.chart?.result?.[0];
      if(!result) return res.status(500).json({ error:'no data' });
    } catch(e){
      if(/403|missing finance API key/i.test(e.message)){
        try {
          const data = await yahooPublicChart(symbol, rng, iv);
          result = data.chart?.result?.[0];
          if(!result) return res.status(500).json({ error:'no data (fallback)' });
        } catch(fb){ return res.status(500).json({ error:'rapid+fallback failed', detail:fb.message }); }
      } else {
        return res.status(500).json({ error:e.message });
      }
    }
    const timestamps = result.timestamp||[];
    const q = result.indicators?.quote?.[0]||{};
    const candles = timestamps.map((t,i)=>({ t:t*1000,o:q.open?.[i]??null,h:q.high?.[i]??null,l:q.low?.[i]??null,c:q.close?.[i]??null,v:q.volume?.[i]??null })).filter(c=>c.c!=null);
    payload = { symbol, range:rng, interval:iv, candles, meta:{ currency:result.meta?.currency, exchange:result.meta?.exchangeName } };
    finSet(key,payload);
    res.json(payload);
  } catch(e){ console.error('[api/quotes/history] error', e); res.status(500).json({ error:e.message }); }
});

// GET /api/quotes/search?q=AAPL
app.get('/api/quotes/search', async (req,res)=>{
  try {
    const qStr = (req.query.q||'').toString().trim();
    if(!qStr) return res.json({ items:[] });
    const key='search:'+qStr.toLowerCase();
    const cached=finGet(key,300000); if(cached) return res.json({ cached:true, ...cached });
    const data = await rapid('/auto-complete', { q:qStr });
    const items = (data.quotes||[]).slice(0,10).map(it=>({ symbol:it.symbol, name:it.shortname||it.longname||it.symbol, type:it.typeDisp }));
    finSet(key,{ items });
    res.json({ cached:false, items });
  } catch(e){ console.error('[api/quotes/search] error', e); res.status(500).json({ error:e.message }); }
});

// GET /api/quotes/news?symbol=AAPL
app.get('/api/quotes/news', async (req,res)=>{
  try {
    const symbol = (req.query.symbol||'').toString().trim();
    if(!symbol) return res.json({ items:[] });
    const key='news:'+symbol.toUpperCase();
    const cached=finGet(key,300000); if(cached) return res.json({ cached:true, ...cached });
    const data = await rapid('/stock/v2/get-newsfeed', { s:symbol });
    const items = (data.items||data.news||[]).slice(0,20).map((n,i)=>({ id:n.uuid||n.id||symbol+':'+i, title:n.title||n.headline, link:n.link||n.url, publisher:n.publisher||n.provider||'', published:n.providerPublishTime? n.providerPublishTime*1000:null })).filter(it=>it.title && it.link);
    finSet(key,{ items });
    res.json({ cached:false, items });
  } catch(e){ console.error('[api/quotes/news] error', e); res.status(500).json({ error:e.message }); }
});

// GET /api/quotes/fundamentals?symbol=AAPL&modules=assetProfile,summaryProfile,fundProfile
app.get('/api/quotes/fundamentals', async (req,res)=>{
  try {
    const symbol=(req.query.symbol||'').toString().trim();
    if(!symbol) return res.status(400).json({ error:'symbol required' });
    const modules=(req.query.modules||'assetProfile,summaryProfile,fundProfile').toString();
    const cacheKey = 'fund:'+symbol+':'+modules;
    const cached = finGet(cacheKey, FUND_TTL); if(cached) return res.json({ cached:true, ...cached });
    let data;
    try {
      data = await rapidFund('/stock/get-fundamentals', { region:'US', lang:'en-US', symbol, modules });
    } catch(err){
      if(/401|403/.test(err.message||'')){
        console.warn('[fundamentals] auth failed, returning placeholder');
        return res.json({ symbol, modules: modules.split(','), placeholder:true, data:{} });
      }
      throw err;
    }
    const payload = { symbol, modules: modules.split(','), data };
    finSet(cacheKey, payload);
    res.json(payload);
  } catch(e){ console.error('[api/quotes/fundamentals] error', e); res.status(500).json({ error:e.message }); }
});

// === New Market (apidojo) endpoints ===
// GET /api/market/quotes?symbols=AAPL,MSFT&region=US
app.get('/api/market/quotes', async (req,res)=>{
  try {
    const symbols=(req.query.symbols||'').toString().replace(/\s+/g,'');
    if(!symbols) return res.status(400).json({ error:'symbols required' });
    const region=(req.query.region||'US').toString();
    const data = await rapidMarket('/market/v2/get-quotes', { region, symbols });
    const arr=(data.quoteResponse?.result||[]).map(q=>({
      symbol:q.symbol,
      name:q.shortName||q.longName||q.symbol,
      price:q.regularMarketPrice??null,
      change:q.regularMarketChange??null,
      changePct:q.regularMarketChangePercent!=null?Number(q.regularMarketChangePercent.toFixed(2)):null,
      high:q.regularMarketDayHigh??null,
      low:q.regularMarketDayLow??null,
      currency:q.currency||'',
      marketTime:q.regularMarketTime? q.regularMarketTime*1000:null,
      source:'market'
    }));
    res.json({ data:arr, source:'market', region, ts:Date.now() });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// GET /api/market/spark?symbols=AAPL,MSFT&interval=1m&range=1d
app.get('/api/market/spark', async (req,res)=>{
  try {
    const symbols=(req.query.symbols||'').toString().replace(/\s+/g,'');
    if(!symbols) return res.status(400).json({ error:'symbols required' });
    const interval=(req.query.interval||'1m').toString();
    const range=(req.query.range||'1d').toString();
    const data = await rapidMarket('/market/get-spark', { symbols, interval, range });
    // data is object keyed by symbol; each has timestamp & close arrays
    const out={};
    Object.entries(data||{}).forEach(([sym,obj])=>{
      const tsArr=obj.timestamp||[]; const closeArr=obj.close||obj.closePrices||[];
      out[sym]=tsArr.map((t,i)=>({ t:t*1000, p: closeArr[i]??null })).filter(p=>p.p!=null);
    });
    res.json({ symbols: symbols.split(','), interval, range, series: out, source:'market', ts:Date.now() });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// GET /api/market/trending?region=US
app.get('/api/market/trending', async (req,res)=>{
  try {
    const region=(req.query.region||'US').toString();
    const data = await rapidMarket('/market/get-trending-tickers', { region });
    const symbols=(data.finance?.result?.[0]?.quotes||[]).map(q=>q.symbol).filter(Boolean).slice(0,20);
    res.json({ symbols, region, source:'market', ts:Date.now() });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// GET /api/market/summary?region=US
app.get('/api/market/summary', async (req,res)=>{
  try {
    const region=(req.query.region||'US').toString();
    const data = await rapidMarket('/market/v2/get-summary', { region });
    res.json({ region, source:'market', ts:Date.now(), data });
  } catch(e){ res.status(500).json({ error:e.message }); }
});

// GET /api/quotes/fundamentals/batch?symbols=AAPL,MSFT&modules=assetProfile,summaryProfile
app.get('/api/quotes/fundamentals/batch', async (req,res)=>{
  try {
    const symbolsStr = (req.query.symbols||'').toString().replace(/\s+/g,'');
    if(!symbolsStr) return res.status(400).json({ error:'symbols required' });
    const modules=(req.query.modules||'assetProfile,summaryProfile,fundProfile').toString();
    const symbols = Array.from(new Set(symbolsStr.split(',').filter(Boolean).slice(0,25)));
    const out=[]; const misses=[];
    await Promise.all(symbols.map(async sym=>{
      const cacheKey = 'fund:'+sym+':'+modules;
      const cached = finGet(cacheKey, FUND_TTL); if(cached){ out.push({ symbol:sym, cached:true, ...cached }); return; }
      try {
        const data = await rapidFund('/stock/get-fundamentals', { region:'US', lang:'en-US', symbol:sym, modules });
        const payload = { symbol:sym, modules:modules.split(','), data };
        finSet(cacheKey, payload);
        out.push(payload);
      } catch(err){
        if(/401|403/.test(err.message||'')){
          out.push({ symbol:sym, modules:modules.split(','), placeholder:true, data:{} });
        } else {
          misses.push({ symbol:sym, error: err.message });
        }
      }
    }));
    res.json({ items: out, errors: misses, modules: modules.split(','), ts:Date.now() });
  } catch(e){ console.error('[api/quotes/fundamentals/batch] error', e); res.status(500).json({ error:e.message }); }
});

// GET /api/quotes/trending?region=US  (Recommended / trending symbols)
app.get('/api/quotes/trending', async (req,res)=>{
  const region = (req.query.region||'US').toString().toUpperCase();
  const cacheKey = 'trending:'+region;
  const cached = finGet(cacheKey, 120000); if(cached) return res.json({ cached:true, ...cached });
  let symbols = [];
  let source = 'public';
  try {
    // Public first
    const url = `https://query1.finance.yahoo.com/v1/finance/trending/${encodeURIComponent(region)}`;
    const r = await fetch(url, { headers:{'User-Agent':'Mozilla/5.0'} });
    if(!r.ok) throw new Error('public trending '+r.status);
    const j = await r.json();
    symbols = (j.finance?.result?.[0]?.quotes||[]).map(q=>q.symbol).filter(Boolean).slice(0,15);
  } catch(pubErr){
    console.warn('[trending] public failed', pubErr.message);
    try {
      const data = await rapid('/market/get-trending-tickers', { region });
      symbols = (data.finance?.result?.[0]?.quotes||[]).map(q=>q.symbol).filter(Boolean).slice(0,15);
      source = 'rapid';
    } catch(rapidErr){
      console.warn('[trending] rapid failed, using fallback list', rapidErr.message);
      symbols = ['AAPL','MSFT','GOOGL','AMZN','TSLA','NVDA','META','NFLX'];
      source = 'fallback';
    }
  }
  const payload = { symbols, region, source, ts:Date.now() };
  finSet(cacheKey, payload);
  res.json(payload);
});

const port = process.env.PORT || 4000;
// Graceful redirect for removed news page
app.get('/news.html', (_req,res)=> res.redirect(301,'/finance.html'));

app.listen(port, () => console.log('Server & API listening on http://localhost:' + port));
