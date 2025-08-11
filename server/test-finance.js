import 'dotenv/config';
import fetch from 'node-fetch';

const key = process.env.YF_API_KEY;
if(!key){
  console.error('Missing YF_API_KEY');
  process.exit(1);
}
const host = process.env.YF_API_HOST || 'yh-finance.p.rapidapi.com';
const symbols = process.argv[2] || 'AAPL,MSFT,GOOGL';
(async ()=>{
  try {
    const url = new URL(`https://${host}/market/v2/get-quotes`);
    url.searchParams.set('symbols', symbols);
    const r = await fetch(url, { headers:{ 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host } });
    if(!r.ok){
      console.error('Upstream error', r.status);
      process.exit(2);
    }
    const j = await r.json();
    const data = (j.quoteResponse?.result||[]).map(q=>({
      symbol:q.symbol,
      price:q.regularMarketPrice,
      change:q.regularMarketChange,
      pct:q.regularMarketChangePercent
    }));
    console.log('Fetched', data.length, 'quotes');
    data.forEach(d=> console.log(`${d.symbol}\t${d.price}\t${d.change} (${d.pct?.toFixed?.(2)}%)`));
  } catch(e){
    console.error('Error', e.message);
    process.exit(3);
  }
})();
