const http = require('http');
http.createServer(async (req, res) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  try {
    const u = new URL(req.url, 'http://x').searchParams.get('u');
    const r = await fetch(u);
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { ...cors, 'content-type': r.headers.get('content-type') || 'application/octet-stream' });
    res.end(buf);
  } catch (e) { res.writeHead(502, cors); res.end(String(e)); }
}).listen(8898, () => console.log('proxy up'));
