// Placeholder news module
// Future: integrate climate & severe weather headlines.
export async function initNews(){
  const list = document.getElementById('newsList');
  if(!list) return;
  list.innerHTML = '<li>Loading headlines…</li>';
  try {
    const res = await fetch('/api/news/headlines');
    if(!res.ok) throw new Error('HTTP '+res.status);
    const json = await res.json();
    if(!json?.items) { list.innerHTML='<li>No headlines available</li>'; return; }
    list.innerHTML = json.items.map(i=>{
      const title = i.url ? `<a href="${i.url}" target="_blank" rel="noopener" style="color:#93c5fd;text-decoration:none;">${i.title}</a>` : i.title;
      return `<li><strong>${i.category}:</strong> ${title}${i.source?` <span style=\"opacity:.55;font-size:.55rem;\">(${i.source})</span>`:''}</li>`;
    }).join('');
  } catch (err) {
    console.error('News fetch error', err);
    list.innerHTML = '<li>Error loading headlines</li>';
  }
}
initNews();
