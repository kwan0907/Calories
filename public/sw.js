const CACHE="crab-pos-shell-v12";
const SHELL=["/","/styles.css","/app.js","/config.js"];
const STATIC=["/manifest.webmanifest","/icons/app-icon.png?v=5","/icons/icon.svg?v=5"];
const ASSETS=[...SHELL,...STATIC];

self.addEventListener("install",e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))
});

self.addEventListener("activate",e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))
});

async function networkFirst(req,timeout=1800){
  const cache=await caches.open(CACHE),ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),timeout);
  try{
    const res=await fetch(req,{signal:ctrl.signal});
    if(res&&res.ok)cache.put(req,res.clone());
    return res
  }catch{
    return (await cache.match(req))||(await cache.match("/"))||Response.error()
  }finally{clearTimeout(timer)}
}

async function staleWhileRevalidate(req){
  const cache=await caches.open(CACHE),cached=await cache.match(req);
  const fresh=fetch(req).then(res=>{if(res&&res.ok)cache.put(req,res.clone());return res}).catch(()=>null);
  return cached||(await fresh)||Response.error()
}

self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=="GET"||u.origin!==location.origin||u.pathname.startsWith("/api/"))return;
  if(e.request.mode==="navigate"||["/app.js","/styles.css","/config.js"].includes(u.pathname)){
    e.respondWith(networkFirst(e.request));
    return
  }
  e.respondWith(staleWhileRevalidate(e.request))
});
