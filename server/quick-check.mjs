import fetch from 'node-fetch';
try {
	const ctrl = new AbortController();
	const t = setTimeout(()=>ctrl.abort(), 5000);
	const r = await fetch('http://localhost:4100/api/quotes?symbols=AAPL,MSFT', { signal: ctrl.signal });
	clearTimeout(t);
	console.log('status', r.status);
	const text = await r.text();
	console.log(text.slice(0,300));
} catch(e){
	console.error('fetch error', e.message);
}
