const CACHE='nishad-brand-shell-v1';
const SHELL=['/','/app.js?v=44.65','/style.css','/logo.png','/favicon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.origin!==location.origin || e.request.method!=='GET' || u.pathname.startsWith('/api/')) return;
  e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{const cp=r.clone();caches.open(CACHE).then(x=>x.put(e.request,cp));return r;}).catch(()=>caches.match('/'))));
});
self.addEventListener('sync',e=>{ if(e.tag==='nishad-utr-sync') e.waitUntil(self.clients.matchAll({includeUncontrolled:true,type:'window'}).then(cs=>Promise.all(cs.map(c=>c.postMessage({type:'NISHAD_FLUSH_UTR'})))).catch(()=>{})); });
