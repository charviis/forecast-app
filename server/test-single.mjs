import 'dotenv/config';
import fetch from 'node-fetch';
const host=process.env.YF_API_HOST||'yh-finance.p.rapidapi.com';
const key=process.env.YF_API_KEY;
const url=`https://${host}/market/v2/get-quotes?symbols=AAPL`;
const r = await fetch(url,{headers:{'X-RapidAPI-Key':key,'X-RapidAPI-Host':host}});
console.log('status', r.status);
console.log(await r.text());
