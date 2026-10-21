// Same-origin, read-only bridge to a Google Apps Script deployment.
// The source GAS is already public. This endpoint does not accept writes.
const FALLBACK_GAS = 'https://script.google.com/macros/s/AKfycbzVH590xEb1zqSQVz2DOvfZEYoiG4UgHCwhB54DvkzXYUbhKpwTjICCLIoKVra8tlQu-A/exec';
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') return res.status(405).json({ok:false,error:'僅支援讀取'});
  const url = String(req.query.url || FALLBACK_GAS);
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url))
    return res.status(400).json({ok:false,error:'GAS 網址格式錯誤'});
  const callback = 'cloudCallback_bridge';
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),18000);
  try {
    const upstream = await fetch(url+'?action=list&callback='+callback, {
      signal:controller.signal,redirect:'follow',headers:{'Accept':'text/javascript,*/*'}
    });
    const body = await upstream.text();
    if (!upstream.ok) throw new Error('GAS HTTP '+upstream.status);
    const prefix=callback+'(';
    const trim=body.trim();
    if(!trim.startsWith(prefix)||!trim.endsWith(');')) throw new Error('GAS 未回傳預期格式（請檢查 /exec 部署權限）');
    const data=JSON.parse(trim.slice(prefix.length,-2));
    if(!data || typeof data.ok!=='boolean') throw new Error('GAS 資料格式錯誤');
    return res.status(data.ok?200:502).json(data);
  }catch(err){
    return res.status(502).json({ok:false,error:'無法透過雲端橋接讀取 GAS：'+(err.name==='AbortError'?'連線逾時':err.message)});
  }finally{clearTimeout(timer);}
};
