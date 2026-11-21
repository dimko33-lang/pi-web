'use strict';
(() => {
const $ = s => document.querySelector(s);
const status = $('#status');
const fail = (node, text) => { const p=document.createElement('p'); p.className='render-error';p.textContent=text;node.append(p); };
const finite = v => typeof v==='number' && Number.isFinite(v) && Math.abs(v)<1e100;
const label = v => typeof v==='string' ? v.slice(0,200).replace(/</g,'‹').replace(/>/g,'›') : '';
async function load(path, maxChars=600000) {
 const response=await fetch(path,{credentials:'same-origin',cache:path==='/nikita/lightcone/messages.json'?'no-cache':'no-store'});
 if(!response.ok)throw new Error('Page unavailable');
 const raw=await response.text();if(raw.length>maxChars)throw new Error('Document too large');return JSON.parse(raw);
}
function prepareMath(text) {
 const math=[];
 const source=text.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g).map((part,i)=>i%2?part:part.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|(?<![\\$])\$([^\n$]+?)\$(?!\$)|\\\(([^\n]+?)\\\)/g,(all,a,b,c,d)=> {
  const index=math.length;math.push({source:a??b??c??d,display:a!==undefined||b!==undefined});return '<span data-math="'+index+'"></span>';
 })).join('');return {source,math};
}
function diagram(spec, container) {
 if(!spec || !Array.isArray(spec.nodes) || !Array.isArray(spec.edges) || spec.nodes.length<1 || spec.nodes.length>40 || spec.edges.length>80)throw new Error('Diagrams support 1–40 nodes and up to 80 edges');
 const ns='http://www.w3.org/2000/svg',make=(tag,attrs={})=>{const el=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,String(v));return el;};
 const nodes=new Map(), cols=Math.min(3,spec.nodes.length), height=Math.ceil(spec.nodes.length/cols)*120+40, width=900;
 for(const [i,n]of spec.nodes.entries()) {if(typeof n.id!=='string'||nodes.has(n.id))throw new Error('Node IDs must be unique strings');nodes.set(n.id,{label:label(n.label||n.id),x:finite(n.x)?Math.max(100,Math.min(800,n.x)):150+(i%cols)*300,y:finite(n.y)?Math.max(40,Math.min(height-40,n.y)):70+Math.floor(i/cols)*120});}
 const svg=make('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':'Diagram'});
 const defs=make('defs'),marker=make('marker',{id:'arrow-'+Math.random().toString(36).slice(2),viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'});
 marker.append(make('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'#777'}));defs.append(marker);svg.append(defs);
 for(const edge of spec.edges){const a=nodes.get(edge.from),b=nodes.get(edge.to);if(!a||!b)throw new Error('Edge references an unknown node');svg.append(make('line',{x1:a.x,y1:a.y+25,x2:b.x,y2:b.y-25,stroke:'#777','stroke-width':1.5,'marker-end':`url(#${marker.id})`}));if(edge.label){const t=make('text',{x:(a.x+b.x)/2+8,y:(a.y+b.y)/2,fill:'#999','font-size':12});t.textContent=label(edge.label);svg.append(t);}}
 for(const n of nodes.values()){svg.append(make('rect',{x:n.x-125,y:n.y-25,width:250,height:50,rx:4,fill:'#111',stroke:'#444'}));const t=make('text',{x:n.x,y:n.y+5,'text-anchor':'middle',fill:'#bdbdbd','font-size':14});t.textContent=n.label.length>30?n.label.slice(0,29)+'…':n.label;const title=make('title');title.textContent=n.label;t.append(title);svg.append(t);}
 let zoom=1;for(const [caption,scale]of [['−',.8],['+',1.25],['Reset',0]]){const button=document.createElement('button');button.textContent=caption;button.type='button';button.addEventListener('click',()=>{zoom=scale?Math.max(.5,Math.min(3,zoom*scale)):1;const w=width/zoom,h=height/zoom;svg.setAttribute('viewBox',`${(width-w)/2} ${(height-h)/2} ${w} ${h}`);});container.append(button);}container.append(svg);
}
let plotlyReady;
function loadPlotly(){return plotlyReady ||= new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/nikita/vendor/plotly.js';script.onload=resolve;script.onerror=()=>{plotlyReady=null;script.remove();reject(new Error('Chart library unavailable'));};document.head.append(script);});}
async function chart(spec, container) {
 if(!spec||!Array.isArray(spec.data)||spec.data.length<1||spec.data.length>8)throw new Error('Charts support 1–8 series');
 const data=spec.data.map(t=>{if(!['scatter','bar'].includes(t.type||'scatter')||!Array.isArray(t.x)||!Array.isArray(t.y)||t.x.length!==t.y.length||t.x.length>5000||!t.y.every(finite)||!t.x.every(v=>finite(v)||(typeof v==='string'&&v.length<100)))throw new Error('Invalid chart data');const out={type:t.type||'scatter',x:t.x.map(v=>typeof v==='string'?label(v):v),y:t.y,name:label(t.name),mode:['lines','markers','lines+markers'].includes(t.mode)?t.mode:'lines'};return out;});
 const l=spec.layout||{},title=typeof l.title==='string'?l.title:l.title?.text;
 const axisTitle=a=>label(typeof a?.title==='string'?a.title:a?.title?.text);
 await loadPlotly();
 await Plotly.newPlot(container,data,{title:{text:label(title),font:{size:16}},paper_bgcolor:'#000',plot_bgcolor:'#000',font:{color:'#bdbdbd',family:'Arial, sans-serif'},xaxis:{title:{text:axisTitle(l.xaxis)},gridcolor:'#222',zerolinecolor:'#444'},yaxis:{title:{text:axisTitle(l.yaxis)},gridcolor:'#222',zerolinecolor:'#444'},margin:{l:58,r:18,t:60,b:55},autosize:true},{responsive:true,displaylogo:false,showTips:false,scrollZoom:false,modeBarButtonsToRemove:['sendDataToCloud']});
}
async function render(doc, target=null) {
 if(typeof doc.body!=='string'||typeof doc.title!=='string')throw new Error('Invalid publication format');
 if(!target)document.title=doc.title+' — nikita';
 const article=target||$('#answer'),{source,math}=prepareMath(doc.body);
 article.innerHTML=DOMPurify.sanitize(marked.parse(source,{gfm:true}),{FORBID_TAGS:['style','script','iframe','object','embed','form','input','button','img','video','audio'],FORBID_ATTR:['style','srcset'],ALLOW_DATA_ATTR:true});
 for(const a of article.querySelectorAll('a')){const url=new URL(a.getAttribute('href')||'',location.href);if(!['https:','http:'].includes(url.protocol)){a.removeAttribute('href');}a.rel='noopener noreferrer';}
 for(const span of article.querySelectorAll('[data-math]')){const item=math[Number(span.dataset.math)];if(!item)continue;try{katex.render(item.source,span,{displayMode:item.display,throwOnError:false,trust:false,strict:'warn',maxExpand:1000,maxSize:30});}catch(e){span.textContent=item.source;}}
 article.hidden=false;
 for(const code of article.querySelectorAll('pre > code.language-plotly, pre > code.language-diagram')) {
  const holder=document.createElement('div');holder.className=code.classList.contains('language-plotly')?'chart':'diagram';
  try{const spec=JSON.parse(code.textContent);code.parentElement.replaceWith(holder);if(holder.className==='chart')await chart(spec,holder);else diagram(spec,holder);}catch(e){fail(holder,'Could not render visualization: '+e.message);const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Source data';details.append(summary,code.cloneNode(true));holder.append(details);}
 }
 if(!target){status.hidden=true;document.dispatchEvent(new Event('nikita-rendered'));}
}
const MOSCOW_STAMP=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
function localStamp(day,hour,minute){return day.slice(8,10)+'.'+day.slice(5,7)+'.'+day.slice(0,4)+', '+hour+':'+minute;}
function stamp(original){const raw=typeof original?.date==='string'?original.date:'';const literal=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(raw);if(literal)return localStamp(literal[1]+'-'+literal[2]+'-'+literal[3],literal[4],literal[5]);const seconds=Number(original?.date_unixtime);if(String(original?.date_unixtime??'').trim()!==''&&Number.isFinite(seconds)&&seconds>=0&&seconds<253402300800)return MOSCOW_STAMP.format(new Date(seconds*1000));return 'Open in LightCone';}
function createdStamp(value){const date=new Date(value);return Number.isNaN(date.getTime())?'':MOSCOW_STAMP.format(date);}
async function channelFeed(piweb) {
 const channel=piweb?'Pi Web':'LightCone', folder=piweb?'piwep':'lightcone';
 document.title='nikita · '+channel;$('#lightcone').hidden=false;
 const feed=$('#lightcone-messages'),seen=new Set();let busy=false,first=true;
 async function refresh(){
  if(busy)return;busy=true;
  try{
   const archive=await load('/nikita/'+folder+'/messages.json',64000000);
   if(archive.author?.id!=='local-nikita'||!Array.isArray(archive.messages))throw new Error('Invalid archive');
   const fresh=archive.messages.filter(m=>m.author_id==='local-nikita'&&Number.isSafeInteger(m.original?.id)&&m.original.id>0&&typeof m.text==='string'&&!seen.has(m.original.id)).sort((a,b)=>b.original.id-a.original.id);
   const anchor=feed.firstChild,oldHeight=document.documentElement.scrollHeight,hold=!first&&scrollY>100;
   for(const [i,m]of fresh.entries()){
    const box=document.createElement('article');box.className='message feed-message';box.id='message-'+m.original.id;
    const source=document.createElement('a');source.className='feed-source';source.href='https://t.me/c/'+(piweb?'3723060288':'1954092303')+'/'+m.original.id;source.rel='noopener noreferrer';
    source.textContent=stamp(m.original);
    const body=document.createElement('div');box.append(body,source);feed.insertBefore(box,first?null:anchor);
    await render({title:channel,body:m.text},body);
    if(piweb && m.photo===true)addPhoto(body,folder,m.original.id);
    seen.add(m.original.id);
    if(i%12===11)await new Promise(resolve=>setTimeout(resolve,0));
   }
   if(hold)window.scrollBy(0,document.documentElement.scrollHeight-oldHeight);
   first=false;status.hidden=true;document.dispatchEvent(new Event('nikita-lightcone-ready'));
  }catch(e){status.hidden=false;status.textContent=e.message;}finally{busy=false;}
 }
 await refresh();
 setInterval(()=>{if(!document.hidden)refresh();},60000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
}
function noteTitle(value){const title=String(value??'');return (title.match(/\*\*/g)||[]).length%2 ? title+'**' : title;}
const photoObserver=new IntersectionObserver(entries=>{for(const {target,isIntersecting} of entries){if(!isIntersecting)continue;photoObserver.unobserve(target);fetch(target.dataset.photo,{credentials:'same-origin'}).then(async r=>{if(!r.ok||!/^image\/(jpeg|png|gif|webp)\b/.test(r.headers.get('content-type')||''))throw Error();const reader=new FileReader();reader.onload=()=>{target.src=reader.result;};reader.readAsDataURL(await r.blob());}).catch(()=>{target.alt='Photo unavailable';});}},{rootMargin:'500px'});
function addPhoto(body,folder,id){const img=document.createElement('img');img.alt='Photo';img.dataset.photo='/nikita/'+folder+'/photos/'+id+'.jpg';img.style.maxWidth='100%';body.prepend(img);photoObserver.observe(img);}
function startTabs(){
 const views=new Map();let active;
 for(const link of document.querySelectorAll('.salon-nav [id$="-tab"]')){
  const key=link.id.slice(0,-4),label=link.textContent,path=link.pathname;
  const el=key==='notes'?$('#list'):document.createElement('section');if(key!=='notes')document.querySelector('main').append(el);el.hidden=true;
  const tab=$('#'+key+'-tab'),v={key,label,path,tab,el,scroll:0,ready:false,busy:false,last:0,rows:[],shown:new Map(),limit:20};views.set(path,v);
  tab.onclick=e=>{if(e.button||e.ctrlKey||e.shiftKey||e.metaKey||e.altKey)return;e.preventDefault();if(active!==v){history.pushState(null,'',path);activate(v);}};
 }
 function indicator(v){if(active!==v)return;status.textContent=v.error||'Loading…';status.hidden=v.ready&&!v.error;}
 function activate(v){if(active)active.scroll=scrollY;active=v;if(v.key!=='notes')sessionStorage.setItem('salon-profile',v.key);$('#panel-link').href='/profiles?chat='+encodeURIComponent(sessionStorage.getItem('salon-profile')||'piwep');for(const item of views.values()){item.el.hidden=item!==v;if(item===v)item.tab.setAttribute('aria-current','page');else item.tab.removeAttribute('aria-current');}document.title='nikita · '+v.label;scrollTo(0,v.scroll);indicator(v);void refresh(v);}
 async function paint(v){if(v.painting||active!==v)return;v.painting=true;try{
  const rows=v.rows.slice(0,v.limit);let prev=null;
  for(const m of rows){if(active!==v)break;const id=m.key??m.original.id;let box=v.shown.get(id);if(!box){box=document.createElement('article');box.className='message feed-message';const body=document.createElement('div'),source=document.createElement('a');source.className='feed-source';if(m.link)source.href=m.link;else if(!m.key)source.href='https://t.me/c/'+(v.key==='piwep'?'3723060288':'1954092303')+'/'+id;source.textContent=stamp(m.original);box.append(body,source);v.el.insertBefore(box,prev?prev.nextSibling:v.el.firstChild);v.shown.set(id,box);await render({title:v.label,body:m.text},body);if(m.file&&/^[0-9]+-[0-9]+\.(jpg|png|gif|webp|mp4|ogg|bin)$/.test(m.file)){const url='/nikita/archive/'+v.key+'/'+m.file;if(['jpg','png','gif','webp'].includes(m.kind)){const img=document.createElement('img');img.alt='Photo';img.style.maxWidth='100%';img.dataset.photo=url;body.prepend(img);photoObserver.observe(img);}else{const a=document.createElement('a');a.href=url;a.download=m.filename||m.file;a.textContent=m.filename||'Attachment';body.append(a);}}else if(m.photo===true)addPhoto(body,v.key,id);await new Promise(r=>setTimeout(r,0));}prev=box;}
 }finally{v.painting=false;}}
 async function refresh(v){if(v.busy)return;if(v.ready&&Date.now()-v.last<30000){if(v.key!=='notes')await paint(v);return;}v.busy=true;try{
 if(v.key==='notes'){const rows=await load('/nikita/data/index.json');if(!Array.isArray(rows))throw Error('Invalid publication list');const sig=JSON.stringify(rows);if(v.signature!==sig){const fragment=document.createDocumentFragment();for(const row of rows){if(!/^[a-f0-9]{24}$/.test(row.id))continue;const li=document.createElement('li'),a=document.createElement('a'),date=document.createElement('small');a.href=/^\d{4}-\d{2}-\d{2}\/[a-z0-9-]+$/.test(row.slug)&&/^[a-f0-9]{32}$/.test(row.share)?'/nikita/'+row.slug+'/?a='+row.share:'/nikita/?p='+row.id;a.innerHTML=DOMPurify.sanitize(marked.parseInline(noteTitle(row.title)),{ALLOWED_TAGS:['strong','em','code','del'],ALLOWED_ATTR:[]});date.textContent=createdStamp(row.created);li.append(a,date);fragment.append(li);}$('#publications').replaceChildren(fragment);v.signature=sig;}}
 else{const full=await load('/nikita/archive/'+v.key+'/messages.json',128000000);if(!Array.isArray(full))throw Error('Invalid archive');const legacy=['piwep','lightcone'].includes(v.key);const archive=legacy?await load(v.path+'messages.json',64000000):{author:{id:'local-nikita'},messages:[]};if(archive.author?.id!=='local-nikita'||!Array.isArray(archive.messages))throw Error('Invalid archive');if(v.key==='lightcone'){const media=await load(v.path+'media.json',6400000);const byId=new Map(archive.messages.map(m=>[m.original?.id,m]));for(const m of media.messages||[]){if(m.author_id!==archive.author.id||!m.photo)continue;const existing=byId.get(m.original.id);if(existing){existing.photo=true;if(!existing.text)existing.text=m.text;}else archive.messages.push(m);}}const next=archive.messages.filter(m=>m.author_id===archive.author.id&&Number.isSafeInteger(m.original?.id)&&m.original.id>0&&typeof m.text==='string').sort((a,b)=>b.original.id-a.original.id);const fromTelegram=new Set(full.map(m=>m.original.id));const combined=full.concat(next.filter(m=>!fromTelegram.has(m.original.id))).sort((a,b)=>Number(b.original.date_unixtime)-Number(a.original.date_unixtime)||b.original.id-a.original.id);const ids=new Set(combined.map(m=>m.key??m.original.id));for(const [id,box] of v.shown)if(!ids.has(id)){box.remove();v.shown.delete(id);}v.rows=combined;await paint(v);}
 v.ready=true;v.error='';v.last=Date.now();}catch(e){v.error=e.message;}finally{v.busy=false;indicator(v);}}
 history.scrollRestoration='manual';window.addEventListener('popstate',()=>{const v=views.get(location.pathname);if(v)activate(v);else location.reload();});
 window.addEventListener('scroll',()=>{const v=active;if(v&&!v.painting&&v.limit<v.rows.length&&scrollY+innerHeight>=document.documentElement.scrollHeight-600){v.limit+=20;void paint(v);}},{passive:true});
 setInterval(()=>{if(!document.hidden&&active)void refresh(active);},60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&active)void refresh(active);});activate(views.get(location.pathname));
}
async function main() {
 if(!new URLSearchParams(location.search).has('a')&&!new URLSearchParams(location.search).has('p')&&[...document.querySelectorAll('.salon-nav [id$="-tab"]')].some(a=>a.pathname===location.pathname)&&$('#piwep-tab')){startTabs();return;}
 const piweb=location.pathname==='/nikita/piwep/', messagesPage=piweb||location.pathname==='/nikita/lightcone/';
 $(piweb?'#piwep-tab':messagesPage?'#lightcone-tab':'#notes-tab')?.setAttribute('aria-current','page');
 if(messagesPage){await channelFeed(piweb);return;}
 const token=new URLSearchParams(location.search).get('a');
 if(token!==null){
  if(!/^\/nikita\/\d{4}-\d{2}-\d{2}\/[a-z0-9-]+\/$/.test(location.pathname)||!/^[a-f0-9]{32}$/.test(token))throw new Error('Invalid article link');
  await render(await load(location.pathname+'read/'+token+'.json'));
  return;
 }
 const rows=await load('/nikita/data/index.json');
 if(!Array.isArray(rows))throw new Error('Invalid publication list');
 const validSlug=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
 const path=location.pathname.match(/^\/nikita\/(\d{4}-\d{2}-\d{2}\/[a-z0-9-]+)\/$/);
 const oldId=new URLSearchParams(location.search).get('p');
 if(path||oldId){
  if(oldId&&!/^[a-f0-9]{24}$/.test(oldId))throw new Error('Invalid publication URL');
  const row=rows.find(r=>path?r.slug===path[1]:r.id===oldId);
  if(!row||!/^[a-f0-9]{24}$/.test(row.id))throw new Error('Publication not found');
  await render(await load('/nikita/data/'+row.id+'.json'));
  if(validSlug(row.slug)&&/^[a-f0-9]{32}$/.test(row.share))history.replaceState(null,'','/nikita/'+row.slug+'/?a='+row.share);
 }
 else {for(const row of rows){if(!/^[a-f0-9]{24}$/.test(row.id))continue;const li=document.createElement('li'),a=document.createElement('a'),date=document.createElement('small');a.href=validSlug(row.slug)?'/nikita/'+row.slug+'/?a='+row.share:'/nikita/?p='+row.id;a.innerHTML=DOMPurify.sanitize(marked.parseInline(noteTitle(row.title)),{ALLOWED_TAGS:['strong','em','code','del'],ALLOWED_ATTR:[]});date.textContent=createdStamp(row.created);li.append(a,date);$('#publications').append(li);}$('#list').hidden=false;status.hidden=true;}
}
main().catch(e=>{status.hidden=false;status.textContent=e.message;});
})();
