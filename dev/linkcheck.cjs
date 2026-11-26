// Every relative reference in every page must point at a real file
const fs=require('fs'),path=require('path');
const dir=path.resolve(process.argv[2]); const broken=new Map(); let refs=0, pagesN=0;
const files=[];(function w(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f);if(fs.statSync(p).isDirectory()){if(!/^(node_modules|cms)$/.test(f))w(p)}else if(f.endsWith('.html'))files.push(p)}})(dir);
const exists=(abs)=>{try{const st=fs.statSync(abs);if(st.isFile())return true;if(st.isDirectory())return fs.existsSync(path.join(abs,'index.html'))}catch{}return false};
for(const f of files){pagesN++;const html=fs.readFileSync(f,'utf8');const base=path.dirname(f);const is404=path.basename(f)==='404.html';
 const add=(u,attr)=>{u=(u||'').trim().replace(/&amp;/g,'&');if(!u||/^(?:[a-z]+:|\/\/|#|data:|\{|\$)/i.test(u))return;refs++;let p=u.split('#')[0].split('?')[0];if(!p)return;try{p=decodeURIComponent(p)}catch{}const abs=p.startsWith('/')?path.join(dir,p):path.join(base,p);if(!exists(abs)){const k=attr+' '+u;if(!broken.has(k))broken.set(k,path.relative(dir,f))}};
 const body=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,m=>m.replace(/>[\s\S]*<\//,'></'));
 for(const m of body.matchAll(/\s(href|src|poster|data-src|data-poster-url)\s*=\s*"([^"]*)"/gi)){if(/href/i.test(m[1])&&/<link[^>]*rel="(?:canonical|alternate)/.test('')) continue;add(m[2],m[1])}
 for(const m of body.matchAll(/\ssrcset\s*=\s*"([^"]*)"/gi))m[1].split(',').forEach(x=>add(x.trim().split(/\s+/)[0],'srcset'));
 for(const m of body.matchAll(/url\(\s*(?:&quot;|["']?)([^"')&]+)/gi))add(m[1],'url');
 for(const m of body.matchAll(/\sdata-video-urls\s*=\s*"([^"]*)"/gi))m[1].split(',').forEach(x=>add(x,'video'));
}
console.log(`pages ${pagesN}, refs ${refs}, broken ${broken.size}`);[...broken].slice(0,15).forEach(([k,v])=>console.log('  ✗',k.slice(0,140),' ←',v));
process.exitCode=broken.size?1:0;
