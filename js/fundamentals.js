// Fundamentals viewer script
const API_BASES = ['','http://localhost:4100','http://localhost:4000'];
const form = document.getElementById('fundForm');
const symbolsInput = document.getElementById('fundSymbols');
const modulesSelect = document.getElementById('fundModules');
const grid = document.getElementById('fundGrid');
const statusEl = document.getElementById('fundStatus');
const refreshBtn = document.getElementById('fundRefresh');

async function fetchBatch(symbols, modules, force){
  const q = `/api/quotes/fundamentals/batch?symbols=${encodeURIComponent(symbols)}&modules=${encodeURIComponent(modules)}${force?'&force=1':''}`;
  let last; for(const base of API_BASES){ try { const r=await fetch(base+q); if(!r.ok){ last=new Error('status '+r.status); continue; } return await r.json(); } catch(e){ last=e; } }
  throw last||new Error('fetch failed');
}

function renderItem(item){
  if(item.placeholder){
    return `<div class='glass' style='padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,0.12);'>
      <h3 style='margin:0 0 4px;font-size:.75rem;'>${item.symbol}</h3>
      <div style='font-size:.55rem;opacity:.6;'>No fundamentals (placeholder)</div>
    </div>`;
  }
  const ap = item.data?.assetProfile||item.data?.summaryProfile||{};
  const sector = ap.sector||''; const industry=ap.industry||''; const country=ap.country||ap.countryName||'';
  let desc = ap.longBusinessSummary||''; if(desc.length>320) desc = desc.slice(0,320)+'…';
  return `<div class='glass' style='padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,0.12);display:flex;flex-direction:column;gap:6px;'>
    <div style='display:flex;justify-content:space-between;align-items:center;'>
      <h3 style='margin:0;font-size:.75rem;'>${item.symbol}</h3>
      ${item.cached?'<span style="font-size:.45rem;opacity:.55;">cache</span>':''}
    </div>
    <div style='font-size:.55rem;display:flex;flex-wrap:wrap;gap:10px;opacity:.75;'>
      ${sector?`<span>${sector}</span>`:''}
      ${industry?`<span>${industry}</span>`:''}
      ${country?`<span>${country}</span>`:''}
    </div>
    ${desc?`<div style='font-size:.52rem;line-height:1.3;opacity:.8;'>${desc}</div>`:''}
  </div>`;
}

async function loadFundamentals(force=false){
  const symbols = symbolsInput.value.split(/[ ,\n\t]+/).filter(Boolean).slice(0,25).join(',');
  if(!symbols){ grid.innerHTML='<div style="opacity:.6;font-size:.6rem;">Enter symbols</div>'; return; }
  const modules = modulesSelect.value;
  statusEl.textContent = 'Loading…';
  grid.innerHTML = '';
  try {
    const data = await fetchBatch(symbols, modules, force);
    statusEl.textContent = `Loaded ${data.items.length} symbols ${data.items.some(i=>i.placeholder)?'(some placeholders)':''}`;
    grid.innerHTML = data.items.map(renderItem).join('');
  } catch(e){
    statusEl.textContent = 'Error: '+e.message;
    grid.innerHTML = '<div style="opacity:.6;font-size:.6rem;">Failed to load</div>';
  }
}

form?.addEventListener('submit', e=>{ e.preventDefault(); loadFundamentals(false); });
refreshBtn?.addEventListener('click', ()=> loadFundamentals(true));

loadFundamentals();
