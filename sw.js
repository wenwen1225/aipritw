const CACHE='card-drop-tracker-v3-fourstar-tracking';
const ASSETS=['./','./index.html','./manifest.webmanifest'];

self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});

self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',e=>{
  if(e.request.mode==='navigate'){
    e.respondWith(
      fetch(e.request)
        .then(response=>{
          const copy=response.clone();
          caches.open(CACHE).then(c=>c.put(e.request,copy));
          return response;
        })
        .catch(()=>caches.match(e.request).then(r=>r||caches.match('./')))
    );
    return;
  }
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
