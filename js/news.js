const NEWS_BASES = (() => {
  const bases = [];
  if(location.protocol === 'file:') {
    bases.push('http://localhost:4000');
  } else {
    bases.push('');
    if(!/:(4000)$/.test(location.host)) bases.push('http://localhost:4000');
  }
  bases.push('http://127.0.0.1:4000');
  return [...new Set(bases)];
})();

async function fetchNews(){
  let lastErr; let json;
  for(const base of NEWS_BASES){
    try {
      const r = await fetch(base + '/api/news/headlines');
      if(!r.ok){ lastErr = new Error(base+': HTTP '+r.status); continue; }
      json = await r.json();
      return json;
    } catch(e){ lastErr = e; }
  }
  throw lastErr || new Error('All news endpoints failed');
}

export async function initNews(){
  const list = document.getElementById('newsList');
  if(!list) return;
  list.innerHTML = '<li>Loading headlines…</li>';
  try {
  const json = await fetchNews();
    if(!json?.items) { list.innerHTML='<li>No headlines available</li>'; return; }
    list.innerHTML = json.items.map(i=>{
      const title = i.url ? `<a href="${i.url}" target="_blank" rel="noopener" style="color:#93c5fd;text-decoration:none;">${i.title}</a>` : i.title;
      return `<li><strong>${i.category}:</strong> ${title}${i.source?` <span style=\"opacity:.55;font-size:.55rem;\">(${i.source})</span>`:''}</li>`;
    }).join('');
  } catch (err) {
    console.error('News fetch error', err);
  list.innerHTML = `<li>Error loading headlines: <span style='opacity:.7'>${err.message}</span> (Tried ${NEWS_BASES.join(', ')})</li>`;
  }
}
initNews();
