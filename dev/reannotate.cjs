// Re-run CMS detection on an existing export zip's pages (markers stripped first)
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const {DOMParser}=require('linkedom');
delete require.cache[require.resolve(require('path').resolve(__dirname,'../webflow-cms.js'))];
globalThis.WFX_DEBUG=process.env.DBG;const C=require(require('path').resolve(__dirname,'../webflow-cms.js'));
const zip=process.argv[2], tmp=fs.mkdtempSync('/tmp/claude-501/ra-');
execFileSync("unzip",["-q",zip,"-d",tmp]);
const dir=path.join(tmp,fs.readdirSync(tmp)[0]);
const pages=[];
(function w(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f);if(fs.statSync(p).isDirectory()){if(d===dir&&/^(css|js|images|fonts|videos|data|documents|cms|api|fx-server|netlify|media|other)$/.test(f))continue;w(p)}else if(f==='index.html'){pages.push({key:path.relative(dir,d),html:fs.readFileSync(p,'utf8').replace(/ data-wfx-[fi]="[^"]*"/g,'')})}}})(dir);
const t=Date.now(); const r=C.annotate(pages,{DOMParser});
if(!r){console.log('NO CMS');process.exit()}
console.log(`${Date.now()-t}ms`, JSON.stringify(r.stats));
for(const c of r.manifest.collections){console.log(` ${c.name} ×${c.items.length}${c.listOnly?' [list-only]':''} lists:${c.listPages.length}${c.paginated&&c.paginated.length?' paginated:'+c.paginated.map(p=>p.pages.length+'x'+p.size).join(','):''}\n    `+c.fields.map(f=>f.title+':'+(f.kind||'-')+(f.ref?'→'+(r.manifest.collections.find(o=>o.id===f.ref)||{}).name:'')).join(', '));}
if(process.argv[3]){const out=process.argv[3];fs.rmSync(out,{recursive:true,force:true});fs.cpSync(dir,out,{recursive:true});for(const [k,h] of r.pages)fs.writeFileSync(path.join(out,k?k+'/index.html':'index.html'),h);fs.writeFileSync(path.join(out,'cms/fx-site.json'),JSON.stringify(r.manifest));}
fs.rmSync(tmp,{recursive:true,force:true});
