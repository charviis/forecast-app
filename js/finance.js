// Placeholder finance module
// Future: fetch market & commodity data, correlate with weather.
const API_BASE = (location.protocol === 'file:' ? 'http://localhost:4000' : '');

export function initFinance(){
  const list = document.getElementById('financeList');
  if(!list) return;
  list.innerHTML = '<li>Loading finance overview…</li>';
fetch(API_BASE + '/api/finance/overview').then(r=>{
      if(!r.ok) throw new Error('HTTP '+r.status);
      return r.json();
    }).then(json => {
      if(!json?.data) { list.innerHTML='<li>Failed to load finance data</li>'; return; }
      list.innerHTML = json.data.map(d=>{
        const price = d.price!=null ? d.price : '—';
        const ch = d.changePct!=null ? (d.changePct>0?'+':'')+d.changePct+'%' : '—';
        return `<li><strong>${d.symbol}</strong> ${d.name}: ${price} <span style="color:${d.changePct>0?'#16a34a':d.changePct<0?'#dc2626':'#888'}">${ch}</span> <em style="opacity:.7">${d.weatherNote}</em></li>`;
      }).join('');
      if(json.notice){
        list.insertAdjacentHTML('beforeend', `<li style="opacity:.6;font-size:.6rem;">${json.notice}</li>`);
      }
  }).catch(err=>{ console.error('Finance fetch error', err); list.innerHTML=`<li>Error loading finance data: <span style='opacity:.7'>${err.message}</span>${API_BASE?" (Did you start the server?)":""}</li>`; });
}
initFinance();
