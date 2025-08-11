//
// REWORKED FINANCE MODULE
// - Modular structure (API, UI, Charts, Modal)
// - Reduced inline styling (uses CSS utility classes)
// - Accessibility: roles, aria-live, keyboard nav, ESC to close modal
// - Lightweight caching for search + quotes
// - Maintains public API: initFinance()
//

const FinanceConfig = {
  quoteLimit: 30,
  searchDebounce: 280,
  historyDefaultRange: '1d',
  bases: (() => {
    const out=[]; out.push('');
    if(!/:(4000)$/.test(location.host)) out.push('http://localhost:4000');
    out.push('http://127.0.0.1:4000');
    return [...new Set(out)];
  })()
};

const FinanceAPI = (()=>{
  async function tryBases(path){
    let lastErr; for(const base of FinanceConfig.bases){
      try { const r=await fetch(base+path); if(!r.ok){ lastErr=new Error(path+' '+r.status); continue; } return await r.json(); } catch(e){ lastErr=e; }
    }
    throw lastErr||new Error('All bases failed '+path);
  }
  return {
    overview: ()=> tryBases('/api/finance/overview'),
    quotes: async symbols => {
      const list = symbols.filter(Boolean).map(s=>s.toUpperCase()).slice(0,FinanceConfig.quoteLimit);
      if(!list.length) return { quotes:[] };
      return tryBases('/api/quotes?symbols='+encodeURIComponent(list.join(',')));
    },
    search: q => q? tryBases('/api/quotes/search?q='+encodeURIComponent(q)).then(j=> j.results||j.items||[]) : Promise.resolve([]),
    history: (sym,range)=> tryBases(`/api/quotes/history?symbol=${encodeURIComponent(sym)}&range=${encodeURIComponent(range||FinanceConfig.historyDefaultRange)}`),
    news: sym => tryBases('/api/quotes/news?symbol='+encodeURIComponent(sym)).then(j=> j.news||j.items||[])
  };
})();

// Simple in-memory caches
const Cache = {
  search: new Map(), // key-> {ts,data}
  quotes: new Map(),
  ttl: { search: 60_000, quotes: 10_000 },
  get(mapName,key){ const m=this[mapName]; const rec=m.get(key); if(!rec) return null; if(Date.now()-rec.ts>this.ttl[mapName]){ m.delete(key); return null; } return rec.data; },
  set(mapName,key,data){ this[mapName].set(key,{ts:Date.now(),data}); }
};

// Utility
const fmt = (n,d=2)=> typeof n==='number' && isFinite(n) ? n.toFixed(d):'—';

function buildQuoteRow(q){
  const ch=q.regularMarketChange; const chPct=q.regularMarketChangePercent;
  const cls = chPct>0?'up': chPct<0?'down':'flat';
  return `<tr data-sym="${q.symbol}" class="quote-row ${cls}" tabindex="0" aria-label="${q.symbol} ${fmt(q.regularMarketPrice)} change ${fmt(ch)} percent ${fmt(chPct)}">
    <td class="sym">${q.symbol}</td>
    <td class="name" title="${q.shortName||q.longName||''}">${q.shortName||q.longName||''}</td>
    <td class="num price">${fmt(q.regularMarketPrice)}</td>
    <td class="num change">${ch>0?'+':''}${fmt(ch)}</td>
    <td class="num pct">${chPct>0?'+':''}${fmt(chPct)}%</td>
    <td class="num hi">${fmt(q.regularMarketDayHigh)}</td>
    <td class="num lo">${fmt(q.regularMarketDayLow)}</td>
  </tr>`;
}

function drawCandles(canvas,candles,range){
  const ctx=canvas.getContext('2d');
  canvas.width=canvas.clientWidth*devicePixelRatio; canvas.height=canvas.clientHeight*devicePixelRatio;
  ctx.scale(devicePixelRatio,devicePixelRatio); ctx.clearRect(0,0,canvas.clientWidth,canvas.clientHeight);
  if(!candles.length) return;
  const maxBars = range==='1d'? 200 : 250; const vis=candles.slice(-maxBars);
  const w=canvas.clientWidth,h=canvas.clientHeight,padL=46,padR=10,padT=10,padB=24;
  const minP=Math.min(...vis.map(c=>c.l)); const maxP=Math.max(...vis.map(c=>c.h)); const span=(maxP-minP)||1;
  const areaW=w-padL-padR; const barW=areaW/vis.length*0.68;
  const y=v=> padT+(1-(v-minP)/span)*(h-padT-padB);
  vis.forEach((c,i)=>{ const xC=padL+(i+0.5)*areaW/vis.length; const rising=c.c>=c.o; ctx.strokeStyle=rising?'#16a34a':'#dc2626'; ctx.fillStyle=rising?'rgba(34,197,94,.7)':'rgba(239,68,68,.7)'; ctx.beginPath(); ctx.moveTo(xC,y(c.h)); ctx.lineTo(xC,y(c.l)); ctx.stroke(); const bodyY=Math.min(y(c.o),y(c.c)); const bodyH=Math.max(2,Math.abs(y(c.o)-y(c.c))); ctx.fillRect(xC-barW/2, bodyY, barW, bodyH); });
  ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.moveTo(padL-12,padT); ctx.lineTo(padL-12,h-padB); ctx.lineTo(w-padR,h-padB); ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,0.65)'; ctx.font='11px system-ui'; ctx.textAlign='right'; for(let i=0;i<=4;i++){ const p=minP+span*(i/4); const yy=y(p); ctx.fillText(p.toFixed(2), padL-16, yy+3); }
}

export function initFinance(){
  const listEl = document.getElementById('financeList');
  if(!listEl) return; // Not on finance page
  listEl.innerHTML='<li>Loading finance overview…</li>';

  // QUOTES UI
  const qBody = document.getElementById('quotesBody');
  const qInput = document.getElementById('quoteSymbolsInput');
  const qForm = document.getElementById('quoteSymbolsForm');
  const qRefresh = document.getElementById('quoteRefresh');
  const searchInput = document.getElementById('quoteSearch');
  const searchResults = document.getElementById('quoteSearchResults');
  const searchTpl = document.getElementById('quoteSearchItemTpl');
  const modal = document.getElementById('stockModal');
  const modalClose = document.getElementById('modalClose');
  const modalSymbol = document.getElementById('modalSymbol');
  const modalMeta = document.getElementById('modalMeta');
  const modalChart = document.getElementById('modalChart');
  const modalNews = document.getElementById('modalNews');
  const modalRanges = document.getElementById('modalRanges');
  let modalRange = FinanceConfig.historyDefaultRange;
  let modalSym=null;
  let currentQuotes=[];

  async function loadQuotes(){
    if(!qBody||!qInput) return; const rawSyms=qInput.value.split(/[ ,\n\t]+/).filter(Boolean);
    const key=rawSyms.sort().join(',');
    qBody.innerHTML='<tr><td colspan="7" class="loading">Loading…</td></tr>';
    try {
      const cached=Cache.get('quotes',key);
      const data = cached || await FinanceAPI.quotes(rawSyms);
      if(!cached) Cache.set('quotes',key,data);
      currentQuotes=(data.quotes||data.data||[]);
      if(!currentQuotes.length){ qBody.innerHTML='<tr><td colspan="7" class="empty">No quotes</td></tr>'; return; }
      qBody.innerHTML=currentQuotes.map(buildQuoteRow).join('');
      qBody.querySelectorAll('tr.quote-row').forEach(tr=>{
        tr.addEventListener('click',()=> openModal(tr.getAttribute('data-sym')));
        tr.addEventListener('keydown',e=>{ if(e.key==='Enter' || e.key===' ') { e.preventDefault(); openModal(tr.getAttribute('data-sym')); }});
      });
    } catch(e){ qBody.innerHTML=`<tr><td colspan="7" class="error">Error: ${e.message}</td></tr>`; }
  }

  qForm?.addEventListener('submit', e=>{ e.preventDefault(); loadQuotes(); });
  qRefresh?.addEventListener('click', loadQuotes);

  // SEARCH
  let searchTimer; let lastQ=''; let keyboardIndex=-1;
  function clearSearch(){ searchResults.innerHTML=''; searchResults.style.display='none'; keyboardIndex=-1; }
  searchInput?.addEventListener('input', ()=>{
    const q=searchInput.value.trim(); clearTimeout(searchTimer); if(!q){ clearSearch(); return; }
    searchTimer=setTimeout(async ()=>{
      if(q===lastQ) return; lastQ=q;
      const cacheHit=Cache.get('search',q);
      const items = cacheHit || await FinanceAPI.search(q).catch(()=>[]);
      if(!cacheHit) Cache.set('search',q,items);
      if(!items.length){ searchResults.innerHTML='<div class="search-empty">No matches</div>'; searchResults.style.display='block'; return; }
      searchResults.innerHTML = items.slice(0,12).map(it=>{
        const el=searchTpl?.content?.firstElementChild?.cloneNode(true); if(el){ el.textContent=`${it.symbol} — ${it.shortname||it.longname||it.name||''}`; el.setAttribute('data-sym', it.symbol); return el.outerHTML; }
        return `<div class="search-item" data-sym='${it.symbol}'>${it.symbol} — ${it.shortname||it.longname||it.name||''}</div>`;
      }).join('');
      searchResults.style.display='block';
      Array.from(searchResults.children).forEach((ch,i)=> ch.addEventListener('click',()=>{ addSymbol(ch.getAttribute('data-sym')); clearSearch(); }));
    }, FinanceConfig.searchDebounce);
  });
  searchInput?.addEventListener('keydown', e=>{ if(!searchResults || !searchResults.children.length) return; const items=Array.from(searchResults.children); if(e.key==='ArrowDown'){ e.preventDefault(); keyboardIndex=(keyboardIndex+1)%items.length; highlight(); } else if(e.key==='ArrowUp'){ e.preventDefault(); keyboardIndex=(keyboardIndex-1+items.length)%items.length; highlight(); } else if(e.key==='Enter'){ if(keyboardIndex>=0){ e.preventDefault(); const sym=items[keyboardIndex].getAttribute('data-sym'); addSymbol(sym); clearSearch(); } } else if(e.key==='Escape'){ clearSearch(); } });
  function highlight(){ Array.from(searchResults.children).forEach((el,i)=> el.classList.toggle('active', i===keyboardIndex)); }
  function addSymbol(sym){ if(!sym||!qInput) return; const set=new Set(qInput.value.split(/[ ,\n\t]+/).filter(Boolean).map(s=>s.toUpperCase())); if(!set.has(sym)){ set.add(sym); qInput.value=Array.from(set).join(','); loadQuotes(); } openModal(sym); }
  document.addEventListener('click', e=>{ if(e.target===searchInput || searchResults.contains(e.target)) return; clearSearch(); });

  // MODAL
  function openModal(sym){ if(!modal || !modalChart) return; modalSym=sym; modalRange=FinanceConfig.historyDefaultRange; modalSymbol.textContent=sym; modal.setAttribute('data-open','1'); modal.removeAttribute('hidden'); modal.style.display='flex'; modalMeta.textContent='Loading…'; modalNews.innerHTML=''; modalRanges.querySelectorAll('.range-btn').forEach(b=> b.classList.toggle('active', b.getAttribute('data-r')===modalRange)); loadModal(); }
  function closeModal(){ if(!modal) return; modal.removeAttribute('data-open'); modal.style.display='none'; modal.setAttribute('hidden',''); }
  modalClose?.addEventListener('click', closeModal);
  modal?.addEventListener('click', e=>{ if(e.target===modal) closeModal(); });
  window.addEventListener('keydown', e=>{ if(e.key==='Escape' && modal?.getAttribute('data-open')==='1') closeModal(); });
  modalRanges?.addEventListener('click', e=>{ const btn=e.target.closest('button[data-r]'); if(!btn) return; modalRange=btn.getAttribute('data-r'); modalRanges.querySelectorAll('.range-btn').forEach(b=> b.classList.toggle('active', b===btn)); loadModal(); });
  async function loadModal(){ if(!modalSym) return; try { const [hist, news] = await Promise.all([ FinanceAPI.history(modalSym, modalRange), FinanceAPI.news(modalSym) ]); drawCandles(modalChart, hist.candles||[], modalRange); const m=hist.meta||{}; modalMeta.innerHTML=`<span>${m.exchange||''}</span><span>${m.currency||''}</span><span>${modalRange}</span><span>${(hist.candles||[]).length} pts</span>`; modalNews.innerHTML=(news||[]).slice(0,8).map(n=>`<li><a href='${n.link}' target='_blank' rel='noopener'>${n.title}</a></li>`).join(''); } catch(e){ modalMeta.textContent='Error loading'; console.warn('modal error', e); }
  }

  // OVERVIEW (legacy style)
  const refreshBtn=document.getElementById('financeRefresh');
  const sortSel=document.getElementById('financeSort');
  const chartSel=document.getElementById('financeChartSymbol');
  const dailyWrap=document.getElementById('dailyStockWrap');
  const dailySel=document.getElementById('dailyStockSymbol');
  const historyStore={}; let overviewData=[];

  refreshBtn?.addEventListener('click', loadOverview);
  sortSel?.addEventListener('change', ()=> renderOverview(overviewData));
  chartSel?.addEventListener('change', ()=> drawHistoryChart());
  dailySel?.addEventListener('change', ()=> drawDailyCandles());

  function renderOverview(data){
    if(!Array.isArray(data)||!data.length){ listEl.innerHTML='<li class="empty">—</li>'; return; }
    const sortBy=sortSel?.value||'symbol';
    const sorted=[...data].sort((a,b)=>{
      if(sortBy==='symbol') return a.symbol.localeCompare(b.symbol);
      if(sortBy==='changePct') return (b.changePct??-999)-(a.changePct??-999);
      if(sortBy==='price') return (b.price??-999)-(a.price??-999);
      return 0;
    });
    const now=Date.now();
    listEl.innerHTML = sorted.map(d=>{
      const chPct=d.changePct!=null? (d.changePct>0?'+':'')+d.changePct+'%':'—';
      const chAbs=d.changeAbs!=null?(d.changeAbs>0?'+':'')+d.changeAbs:'';
      const age=d.marketTime? Math.round((now-d.marketTime)/60000)+'m':'';
      const hiLo=(d.high!=null&&d.low!=null)?`<span class='hl'>H:${d.high} L:${d.low}</span>`:'';
      return `<li class='ov-item'><div class='row1'><strong>${d.symbol}</strong> ${d.name||''} <span class='chg ${d.changePct>0?'pos':d.changePct<0?'neg':'flat'}'>${chPct}</span> <span class='abs'>${chAbs}</span></div><div class='row2'><span>${d.price??'—'} ${d.currency||''}</span>${hiLo}<span class='age'>${age?age+' ago':''}</span><span class='wn'>${d.weatherNote||''}</span></div></li>`;
    }).join('');
  }

  function updateHistoryStore(data){ const ts=Date.now(); data.forEach(d=>{ if(d.price==null) return; const arr=(historyStore[d.symbol]=historyStore[d.symbol]||[]); arr.push({t:ts,p:d.price}); while(arr.length>180) arr.shift(); }); }

  async function loadOverview(){
    listEl.innerHTML='<li>Loading…</li>';
    try { const js=await FinanceAPI.overview(); overviewData=js.data||[]; renderOverview(overviewData); updateHistoryStore(overviewData); populateChartSymbols(); drawHistoryChart(); drawPerformanceChart(); drawDailyCandles(); if(js.notice) listEl.insertAdjacentHTML('beforeend', `<li class='notice'>${js.notice}</li>`); }
    catch(e){ listEl.innerHTML=`<li class='error'>Error: ${e.message}</li>`; }
  }

  function populateChartSymbols(){ if(!chartSel) return; const existing=new Set(Array.from(chartSel.options).map(o=>o.value)); overviewData.forEach(d=>{ if(!existing.has(d.symbol)) chartSel.insertAdjacentHTML('beforeend', `<option value='${d.symbol}'>${d.symbol}</option>`); }); }

  async function drawHistoryChart(){ const canvas=document.getElementById('financeChart'); const legend=document.getElementById('financeChartLegend'); const wrap=document.getElementById('financeChartWrap'); if(!canvas||!legend||!wrap) return; const ctx=canvas.getContext('2d'); const sel=chartSel?.value||'ALL'; let series; if(sel==='ALL') series=Object.entries(historyStore); else { // fetch fresh 1d if not present
      if(!historyStore[sel]){ try { const h=await FinanceAPI.history(sel,'1d'); historyStore[sel]=(h.candles||[]).map(c=>({t:c.t,p:c.c})); } catch{} }
      series=Object.entries(historyStore).filter(([sym])=>sym===sel);
    }
    if(!series.length){ wrap.style.display='none'; return; }
    wrap.style.display='block';
    const allPts=series.flatMap(([_,arr])=>arr); if(!allPts.length){ wrap.style.display='none'; return; }
    let min=Math.min(...allPts.map(p=>p.p)); let max=Math.max(...allPts.map(p=>p.p)); if(!(isFinite(min)&&isFinite(max))){ wrap.style.display='none'; return; }
    if(min===max){ max+=1; min-=1; }
    canvas.width=canvas.clientWidth*devicePixelRatio; canvas.height=canvas.clientHeight*devicePixelRatio; ctx.scale(devicePixelRatio,devicePixelRatio); ctx.clearRect(0,0,canvas.clientWidth,canvas.clientHeight);
    const w=canvas.clientWidth-10,h=canvas.clientHeight-10,left=6,top=4; const tMin=Math.min(...allPts.map(p=>p.t)); const tMax=Math.max(...allPts.map(p=>p.t)); const tSpan=Math.max(1,tMax-tMin);
    const colors=['#60a5fa','#34d399','#fbbf24','#f87171','#c084fc','#38bdf8']; legend.innerHTML='';
    series.forEach(([sym,arr],i)=>{ const col=colors[i%colors.length]; legend.insertAdjacentHTML('beforeend', `<span class='leg-item'><span class='sw' style='background:${col}'></span>${sym}</span>`); ctx.beginPath(); arr.forEach((pt,idx)=>{ const x=left+((pt.t-tMin)/tSpan)*(w-left); const y=top+(1-(pt.p-min)/(max-min))*(h-top); if(idx===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); }); ctx.strokeStyle=col; ctx.lineWidth=1.4; ctx.stroke(); });
    ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.moveTo(5,5); ctx.lineTo(5,h); ctx.lineTo(w,h); ctx.stroke();
  }

  function drawPerformanceChart(){ const canvas=document.getElementById('financePerfChart'); const wrap=document.getElementById('financePerfWrap'); const note=document.getElementById('financeTopNote'); if(!canvas||!wrap) return; const usable=overviewData.filter(d=>typeof d.changePct==='number'); if(!usable.length){ wrap.style.display='none'; return; } wrap.style.display='block'; const sorted=[...usable].sort((a,b)=> (b.changePct??-999)-(a.changePct??-999)); const top=sorted[0]; note.textContent=`${top.symbol} ${top.name||''} leads at ${top.changePct}% (${top.changeAbs>0?'+':''}${top.changeAbs||''})`; const ctx=canvas.getContext('2d'); canvas.width=canvas.clientWidth*devicePixelRatio; canvas.height=canvas.clientHeight*devicePixelRatio; ctx.scale(devicePixelRatio,devicePixelRatio); ctx.clearRect(0,0,canvas.clientWidth,canvas.clientHeight); const maxAbs=Math.max(...sorted.map(d=>Math.abs(d.changePct)))||1; const barH=18,gap=8,left=90,rightPad=16; ctx.font='11px system-ui'; ctx.textBaseline='middle'; sorted.slice(0,7).forEach((d,i)=>{ const y=12+i*(barH+gap); const pct=d.changePct; const w=(canvas.clientWidth-left-rightPad)*(Math.abs(pct)/maxAbs); const grd=ctx.createLinearGradient(left,y,left+w,y); if(pct>0){ grd.addColorStop(0,'rgba(34,197,94,.2)'); grd.addColorStop(1,'rgba(34,197,94,.75)'); } else { grd.addColorStop(0,'rgba(239,68,68,.2)'); grd.addColorStop(1,'rgba(239,68,68,.75)'); } ctx.fillStyle=grd; ctx.strokeStyle=pct>0?'#16a34a':'#dc2626'; ctx.beginPath(); const bw=w,bh=barH; ctx.moveTo(left,y); ctx.lineTo(left+bw-6,y); ctx.quadraticCurveTo(left+bw,y,left+bw,y+6); ctx.lineTo(left+bw,y+bh-6); ctx.quadraticCurveTo(left+bw,y+bh,left+bw-6,y+bh); ctx.lineTo(left,y+bh); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle='#e2f2ff'; ctx.textAlign='right'; ctx.fillText(d.symbol,left-6,y+barH/2); ctx.textAlign='left'; ctx.fillStyle='rgba(255,255,255,.85)'; ctx.fillText((pct>0?'+':'')+pct+'%', left+8,y+barH/2); if(i===0){ ctx.fillStyle='rgba(255,255,255,0.15)'; ctx.fillRect(left-4,y-6,canvas.clientWidth-left-rightPad+8,barH+12); } }); }

  async function drawDailyCandles(){ const wrap=document.getElementById('dailyStockWrap'); const canvas=document.getElementById('dailyStockChart'); const sel=document.getElementById('dailyStockSymbol'); const meta=document.getElementById('dailyStockMeta'); if(!wrap||!canvas||!sel) return; const sym=sel.value||'AAPL'; try { const hist=await FinanceAPI.history(sym,'1d'); const candles=hist.candles||[]; if(!candles.length){ wrap.style.display='none'; return; } wrap.style.display='block'; meta.textContent=`${sym} ${hist.meta?.exchange||''} ${candles.length} bars`; drawCandles(canvas,candles,'1d'); } catch(e){ wrap.style.display='none'; }
  }

  // INITIAL LOAD
  loadOverview();
  if(qInput) loadQuotes();
  return { reload: loadOverview };
}

// Auto-init
initFinance();
