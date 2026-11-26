const fs=require('fs'),path=require('path');const {DOMParser}=require('linkedom');const C=require('../../webflow-cms.js');
const dir=process.argv[2], name=process.argv[3];const pages=[];
(function w(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f);if(fs.statSync(p).isDirectory()){if(d===dir&&/^(css|js|images|fonts|videos|data|documents|cms|api|fx-server|netlify|media|other)$/.test(f))continue;w(p)}else if(f==='index.html')pages.push({key:path.relative(dir,d),html:fs.readFileSync(p,'utf8').replace(/ data-wfx-[fi]="[^"]*"/g,'')})}})(dir);
fs.writeFileSync(`${name}.json`,JSON.stringify(pages));
const r=C.annotate(pages,{DOMParser});
const sum=r.manifest.collections.map(c=>`${c.name}×${c.items.length}:${c.fields.map(f=>f.kind).join(',')}:L${c.listPages.length}`).join(' | ');
const marks=[...r.pages].map(([k,h])=>k+':'+(h.match(/data-wfx-[fi]="[^"]*"/g)||[]).length).sort().join(';');
fs.writeFileSync(`${name}.linkedom.json`,JSON.stringify({sum,marks}));console.log(name,'linkedom:',sum.slice(0,200));
