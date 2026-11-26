const fs=require('fs'),path=require('path');
const {DOMParser}=require('linkedom');
const C=require(require('path').resolve(__dirname,'../webflow-cms.js'));
const dir=process.argv[2];
const pages=[];
(function w(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f);if(fs.statSync(p).isDirectory()){if(!/^(css|js|images|fonts|videos|data|documents|cms)$/.test(f)||d!==dir)w(p)}else if(f==='index.html'){pages.push({key:path.relative(dir,d),html:fs.readFileSync(p,'utf8')})}}})(dir);
const t=Date.now();
const r=C.annotate(pages,{DOMParser});
console.log('ms',Date.now()-t);
if(!r){console.log('NO CMS');process.exit()}
console.log(r.stats);
for(const c of r.manifest.collections){console.log(c.id,c.name,c.pagePrefix,c.items.length,'title',c.titleFieldId);console.log(' fields',c.fields.map(f=>f.id+':'+f.title+':'+f.type).join(' | '));
const it=c.items[0].data;for(const k in it)console.log('   ',k,JSON.stringify(it[k]).slice(0,120));}
if(process.argv[3]){fs.writeFileSync(process.argv[3],JSON.stringify(r.manifest,null,1));}
