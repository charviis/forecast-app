// Placeholder finance module
// Future: fetch market & commodity data, correlate with weather.
const API_BASES = (() => {
  const bases = [];
  const cur = location.origin;
  // If loaded via file://, origin is 'null'
  if(location.protocol === 'file:') {
    bases.push('http://localhost:4000');
  } else {
    bases.push(''); // relative first
    if(!/:(4000)$/.test(location.host)) bases.push('http://localhost:4000');
  }
  bases.push('http://127.0.0.1:4000');
  return [...new Set(bases)];
})();

async function fetchFinance(){
  let lastErr; let respJson;
  for(const base of API_BASES){
    try {
      const r = await fetch(base + '/api/finance/overview');
      if(!r.ok) { lastErr = new Error(base+': HTTP '+r.status); continue; }
      respJson = await r.json();
      return respJson;
    } catch(e){ lastErr = e; }
  }
  throw lastErr || new Error('All finance endpoints failed');
}

export function initFinance(){
  const list = document.getElementById('financeList');
  if(!list) return;
  list.innerHTML = '<li>Loading finance overview…</li>';
fetchFinance().then(json => {
      if(!json?.data) { list.innerHTML='<li>Failed to load finance data</li>'; return; }
      list.innerHTML = json.data.map(d=>{
        const price = d.price!=null ? d.price : '—';
        const ch = d.changePct!=null ? (d.changePct>0?'+':'')+d.changePct+'%' : '—';
        return `<li><strong>${d.symbol}</strong> ${d.name}: ${price} <span style="color:${d.changePct>0?'#16a34a':d.changePct<0?'#dc2626':'#888'}">${ch}</span> <em style="opacity:.7">${d.weatherNote}</em></li>`;
      }).join('');
      if(json.notice){
        list.insertAdjacentHTML('beforeend', `<li style="opacity:.6;font-size:.6rem;">${json.notice}</li>`);
      }
  }).catch(err=>{ console.error('Finance fetch error', err); list.innerHTML=`<li>Error loading finance data: <span style='opacity:.7'>${err.message}</span> (Tried ${API_BASES.join(', ')})</li>`; });
}
initFinance();
