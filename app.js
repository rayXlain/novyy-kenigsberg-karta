const PRI_C = {1:'#ff5470',2:'#ff9f45',3:'#ffd75e',4:'#4fd6bf',5:'#6f8dab'};
const $ = s => document.querySelector(s);
const byId = {}; DATA.projects.forEach(p => byId[p.id] = p);

/* ===== state ===== */
const state = {
  pri: new Set([1,2,3,4,5]),
  scen: new Set(DATA.scenarios),
  conf: new Set(DATA.confidences),
  layers: {districts:true, tram:true, rail:true, river:true, forks:true, context:true},
  sel: null
};
const visible = p => state.pri.has(p.prio) && state.scen.has(p.scen) && state.conf.has(p.conf);

/* ===== map ===== */
const map = new maplibregl.Map({
  container:'map',
  style:{
    version:8,
    sources:{
      base:{type:'raster',tiles:['https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
        tileSize:256,maxzoom:16,
        attribution:'Esri · HERE · Garmin · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · геометрия проектов схематична'},
      labels:{type:'raster',tiles:['https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'],
        tileSize:256,maxzoom:16}
    },
    layers:[
      {id:'bg',type:'background',paint:{'background-color':'#080b10'}},
      {id:'base',type:'raster',source:'base',paint:{'raster-opacity':.9,'raster-contrast':-.06}},
      {id:'labels',type:'raster',source:'labels',paint:{'raster-opacity':.55}}
    ]
  },
  center:[20.512,54.707], zoom:11.6, minZoom:6, maxZoom:17, attributionControl:{compact:true}
});
map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
map.addControl(new maplibregl.ScaleControl({maxWidth:90,unit:'metric'}),'bottom-right');

const fc = f => ({type:'FeatureCollection',features:f});
const feat = (geom,props) => ({type:'Feature',properties:props,geometry:geom});

let GEO=null, HOT={};
function buildGeo(){
  const polys=[], lines=[];
  DATA.projects.forEach(p => (p.geom||[]).forEach(g => {
    const pr = {id:p.id, prio:p.prio, kind:g.kind||'other', name:p.name};
    if(g.type==='polygon'){
      const f = feat({type:'Polygon',coordinates:[g.coords]},pr); f.id = polys.length;
      (HOT[p.id]=HOT[p.id]||[]).push({src:'p-poly',fid:f.id}); polys.push(f);
    } else {
      const f = feat({type:'LineString',coordinates:g.coords},pr); f.id = lines.length;
      (HOT[p.id]=HOT[p.id]||[]).push({src:'p-line',fid:f.id}); lines.push(f);
    }
  }));
  GEO = {polys:fc(polys), lines:fc(lines)};
  return GEO;
}

function initLayers(){
  if(initLayers.done) return; initLayers.done = true;
  const g = buildGeo();
  map.addSource('ctx-lines',{type:'geojson',data:fc(DATA.context.lines.map(l=>feat({type:'LineString',coordinates:l.coords},{kind:l.kind,name:l.name})))});
  map.addSource('p-poly',{type:'geojson',data:g.polys});
  map.addSource('p-line',{type:'geojson',data:g.lines});

  // --- context: river & existing rail
  map.addLayer({id:'river',type:'line',source:'ctx-lines',filter:['==',['get','kind'],'river'],
    paint:{'line-color':'#2d6f8c','line-width':['interpolate',['linear'],['zoom'],9,1.5,14,7],'line-opacity':.75,'line-blur':.4}});
  map.addLayer({id:'rail-exist',type:'line',source:'ctx-lines',filter:['==',['get','kind'],'rail-exist'],
    paint:{'line-color':'#63768c','line-width':1.5,'line-opacity':.85,'line-dasharray':[1,2.2]}});
  map.addLayer({id:'tram-exist',type:'line',source:'ctx-lines',filter:['==',['get','kind'],'tram-exist'],
    paint:{'line-color':'#8ea6c4','line-width':['interpolate',['linear'],['zoom'],11,1.2,15,2.6],'line-opacity':.9}});

  // --- project polygons
  map.addLayer({id:'poly-f',type:'fill',source:'p-poly',
    paint:{'fill-color':['match',['get','prio'],1,PRI_C[1],2,PRI_C[2],3,PRI_C[3],4,PRI_C[4],PRI_C[5]],
      'fill-opacity':['case',['==',['get','kind'],'city'],
        ['case',['boolean',['feature-state','hot'],false],.10,.035],
        ['case',['boolean',['feature-state','hot'],false],.28,.12]]}});
  map.addLayer({id:'poly-l',type:'line',source:'p-poly',
    paint:{'line-color':['match',['get','prio'],1,PRI_C[1],2,PRI_C[2],3,PRI_C[3],4,PRI_C[4],PRI_C[5]],
      'line-width':1.4,'line-opacity':.85,'line-dasharray':[3,2.5]}});

  // --- project lines
  map.addLayer({id:'line-case',type:'line',source:'p-line',
    filter:['!=',['get','kind'],'river-work'],
    layout:{'line-cap':'round'},paint:{'line-color':'#080b10','line-width':['interpolate',['linear'],['zoom'],9,4,15,10],'line-opacity':.5}});
  map.addLayer({id:'line-m',type:'line',source:'p-line',layout:{'line-cap':'butt'},
    paint:{'line-color':['match',['get','prio'],1,PRI_C[1],2,PRI_C[2],3,PRI_C[3],4,PRI_C[4],PRI_C[5]],
      'line-width':['case',['boolean',['feature-state','hot'],false],4.4,
        ['match',['get','kind'],'river-work',1.5,'other',2.0,2.6]],
      'line-opacity':['case',['boolean',['feature-state','hot'],false],.95,
        ['match',['get','kind'],'river-work',.5,.92]],
      'line-dasharray':[2.4,1.8]}});

  addMarkers();
  applyFilters();

  ['poly-f','line-m'].forEach(L=>{
    map.on('mousemove',L,e=>{ map.getCanvas().style.cursor='pointer'; hotItem(e.features[0].properties.id); });
    map.on('mouseleave',L,()=>{ map.getCanvas().style.cursor=''; hotItem(null); });
    map.on('click',L,e=> select(e.features[0].properties.id));
  });
  map.on('zoom',syncPinZoom);
}
// Слои ставим сразу после разбора стиля, не дожидаясь тайлов подложки:
// без сети карта всё равно работает, просто без фона.
map.on('style.load', initLayers);
map.on('styledata', initLayers);
if(map.isStyleLoaded()) initLayers();

/* ===== markers ===== */
const pins = {};
function addMarkers(){
  DATA.projects.forEach(p=>{
    const el = document.createElement('div');
    el.className='pin';
    const s = Math.round(9 + Math.sqrt(p.avg)*2.1);
    el.style.setProperty('--s', s+'px');
    el.style.setProperty('--c', PRI_C[p.prio]);
    el.innerHTML = '<div class="d"></div><div class="lb"><b></b><i></i></div>';
    if(p.cityWide) el.classList.add('city');
    el.querySelector('b').textContent = p.name;
    el.querySelector('i').textContent = p.min+'–'+p.max+' млрд';
    el.addEventListener('click', ev=>{ ev.stopPropagation(); select(p.id); });
    el.addEventListener('mouseenter',()=>hotItem(p.id));
    el.addEventListener('mouseleave',()=>hotItem(null));
    pins[p.id] = new maplibregl.Marker({element:el}).setLngLat(p.at).addTo(map);
  });
  DATA.forks.forEach((f,i)=>{
    const el=document.createElement('div');
    el.className='fork'+(f.status==='решена'?' done':'');
    el.textContent = f.status==='решена' ? '✓' : '?';
    el.title = f.name;
    el.addEventListener('click',ev=>{ev.stopPropagation();openFork(f);});
    f._m = new maplibregl.Marker({element:el}).setLngLat(f.at).addTo(map);
  });
  DATA.context.places.forEach(pl=>{
    const el=document.createElement('div'); el.className='plc'; el.textContent=pl.name;
    pl._m = new maplibregl.Marker({element:el}).setLngLat(pl.at).addTo(map);
  });
  syncPinZoom();
}
function syncPinZoom(){
  const z = map.getZoom();
  DATA.context.places.forEach(pl=>{
    const [a,b] = pl.z || [0,24];
    pl._m.getElement().style.display = (state.layers.context && z>=a && z<=b) ? '' : 'none';
  });
  DATA.projects.forEach(p=>{
    const el = pins[p.id].getElement();
    el.classList.toggle('show', z >= (p.labelZoom||12.4) && visible(p));
  });
}

/* ===== filters ===== */
function applyFilters(){
  const ids = DATA.projects.filter(visible).map(p=>p.id);
  const inIds = ['in',['get','id'],['literal',ids]];
  const L = state.layers;
  const setF=(id,f)=>{ if(map.getLayer(id)) map.setFilter(id,f); };
  const setV=(id,v)=>{ if(map.getLayer(id)) map.setLayoutProperty(id,'visibility',v?'visible':'none'); };
  setF('poly-f',['all',inIds, L.districts?['!=',['get','kind'],'__']:['==',['get','kind'],'__']]);
  setF('poly-l',['all',inIds, L.districts?['!=',['get','kind'],'__']:['==',['get','kind'],'__']]);
  const kinds=[]; if(L.tram)kinds.push('tram'); if(L.rail)kinds.push('rail'); if(L.river)kinds.push('river-work');
  kinds.push('other');
  setF('line-case',['all',inIds,['in',['get','kind'],['literal',kinds]]]);
  setF('line-m',['all',inIds,['in',['get','kind'],['literal',kinds]]]);
  setV('river',L.river); setV('rail-exist',L.context); setV('tram-exist',L.context);
  DATA.projects.forEach(p=> pins[p.id].getElement().style.display = visible(p)?'':'none');
  DATA.forks.forEach(f=> f._m.getElement().style.display = L.forks?'':'none');
  syncPinZoom(); renderList();
}

function renderList(){
  const vis = DATA.projects.filter(visible).sort((a,b)=> a.prio-b.prio || b.avg-a.avg);
  const mn = vis.reduce((s,p)=>s+p.min,0), mx = vis.reduce((s,p)=>s+p.max,0);
  $('#sum').textContent = vis.length ? mn+'–'+mx+' млрд ₽' : '—';
  const box = $('#list');
  if(!vis.length){ box.innerHTML='<div class="empty">Под фильтры ничего не попало</div>'; return; }
  const max = Math.max(...DATA.projects.map(p=>p.avg));
  box.innerHTML = vis.map(p=>`<button class="item${state.sel===p.id?' sel':''}" data-id="${p.id}">
      <span class="nm"><b>${p.name}</b><span class="cost">${p.min}–${p.max}</span></span>
      <span class="meta"><span class="pri" style="color:${PRI_C[p.prio]}">П${p.prio}</span>
      <span class="bar"><i style="width:${Math.max(3,p.avg/max*100)}%;background:${PRI_C[p.prio]}"></i></span>
      <span>${p.district}</span></span></button>`).join('');
  box.querySelectorAll('.item').forEach(b=>{
    b.onclick = ()=> select(b.dataset.id, true);
    b.onmouseenter = ()=> hotItem(b.dataset.id);
    b.onmouseleave = ()=> hotItem(null);
  });
}

let hotId=null;
function hotItem(id){
  if(hotId===id) return;
  setHot(hotId,false); hotId=id; setHot(id,true);
  document.querySelectorAll('.item').forEach(el=>el.classList.toggle('hot', el.dataset.id===id));
}
function setHot(id,on){
  if(!id || !HOT[id]) return;
  HOT[id].forEach(r=> map.setFeatureState({source:r.src,id:r.fid},{hot:on}));
  const el = pins[id] && pins[id].getElement();
  if(el) el.classList.toggle('show', on || (map.getZoom()>=(byId[id].labelZoom||12.4) && visible(byId[id])));
}

/* ===== detail ===== */
function md(text){
  const forkIdx = {}; DATA.forks.forEach((f,i)=> forkIdx[f.name]=i);
  const inline = s => s
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,(m,t,alias)=>{
      const txt = alias||t, pr = DATA.projects.find(x=>x.name===t);
      if(pr) return '<span class="wl" data-go="'+pr.id+'">'+txt+'</span>';
      if(t in forkIdx) return '<span class="wl" data-fork="'+forkIdx[t]+'">'+txt+'</span>';
      return '<span class="wl dead">'+txt+'</span>';
    });
  // Заметки свёрстаны жёсткими переносами: строки одного абзаца склеиваем.
  const blocks=[];               // {t:'p'|'h'|'note'|'li', lines:[]}
  const last = () => blocks[blocks.length-1];
  text.split(/\r?\n/).forEach(raw=>{
    const l = raw.trim();
    if(!l){ blocks.push({t:'gap'}); return; }
    if(/^#{1,6}\s/.test(l)){ blocks.push({t:'h', lines:[l.replace(/^#{1,6}\s/,'')]}); return; }
    if(/^[-*]\s/.test(l)){ blocks.push({t:'li', lines:[l.slice(2).replace(/[;.]$/,'')]}); return; }
    if(/^\d+[.)]\s/.test(l)){ blocks.push({t:'oli', lines:[l.replace(/^\d+[.)]\s/,'')]}); return; }
    if(/^>/.test(l)){ blocks.push({t:'note', lines:[l.replace(/^>\s*/,'').replace(/^\[!\w+\]\s*/,'')]}); return; }
    if(/^---+$/.test(l)){ blocks.push({t:'hr'}); return; }
    const L = last();
    if(L && (L.t==='p' || L.t==='li' || L.t==='oli' || L.t==='note')) L.lines.push(l);
    else blocks.push({t:'p', lines:[l]});
  });
  const html=[]; let inUl=false, inOl=false;
  blocks.forEach(b=>{
    const txt = b.lines ? inline(b.lines.join(' ')) : '';
    if(b.t!=='li' && inUl){ html.push('</ul>'); inUl=false; }
    if(b.t!=='oli' && inOl){ html.push('</ol>'); inOl=false; }
    if(b.t==='li'){ if(!inUl){ html.push('<ul>'); inUl=true; } html.push('<li>'+txt+'</li>'); }
    else if(b.t==='oli'){ if(!inOl){ html.push('<ol>'); inOl=true; } html.push('<li>'+txt+'</li>'); }
    else if(b.t==='h') html.push('<h4>'+txt+'</h4>');
    else if(b.t==='note') html.push('<p class="note">'+txt+'</p>');
    else if(b.t==='p') html.push('<p>'+txt+'</p>');
    else if(b.t==='hr') html.push('<hr>');
  });
  if(inUl) html.push('</ul>');
  if(inOl) html.push('</ol>');
  return html.join('\n');
}

function wireLinks(){
  const b = $('#dBody');
  b.querySelectorAll('[data-go]').forEach(a=> a.onclick=()=>select(a.dataset.go,true));
  b.querySelectorAll('[data-fork]').forEach(a=> a.onclick=()=>openFork(DATA.forks[+a.dataset.fork]));
}
const LOCAL = location.protocol === 'file:';
function obsLink(note){
  if(!note || !LOCAL) return '';
  const u = 'obsidian://open?vault='+encodeURIComponent(DATA.vault)+'&file='+encodeURIComponent(note);
  return '<a class="obs" href="'+u+'">Открыть заметку в Obsidian ↗</a>';
}
function select(id, fly){
  const p = byId[id]; if(!p) return;
  state.sel = id;
  $('#dTitle').textContent = p.name;
  const confC = {'высокая':'var(--p4)','средняя':'var(--p3)','низкая':'var(--p2)','очень низкая':'var(--p1)'}[p.conf]||'var(--tx2)';
  $('#dMeta').innerHTML = `
    <dt>Стоимость</dt><dd>${p.min}–${p.max} млрд ₽</dd>
    <dt>Приоритет</dt><dd><span class="tag" style="color:${PRI_C[p.prio]}">${p.prio}</span> ${p.eff}</dd>
    <dt>Уверенность</dt><dd><span style="color:${confC}">${p.conf}</span></dd>
    <dt>Сценарий</dt><dd>${p.scen}</dd>
    <dt>Район</dt><dd>${p.district}</dd>`;
  $('#dBody').innerHTML = obsLink(p.note)
    + (p.cityWide?'<p class="note">Проект общегородской: точка на карте условна, привязки к месту у него нет.</p>':'')
    + (p.geomNote?'<p class="note">'+p.geomNote+'</p>':'')
    + md(p.body)
    + (p.districtNote?`<div class="note"><b>${p.district}.</b> ${md(p.districtNote).replace(/<\/?p>/g,'')}</div>`:'');
  $('#dBody').scrollTop = 0;
  wireLinks();
  $('#det').classList.add('open');
  Object.entries(pins).forEach(([k,m])=> m.getElement().classList.toggle('sel', k===id));
  renderList();
  if(fly!==false){
    const b = bounds(p);
    if(b) map.fitBounds(b,{padding:{top:80,bottom:80,left:60,right:440},maxZoom:14.2,duration:800});
    else map.easeTo({center:p.at,zoom:Math.max(map.getZoom(),13),duration:700,offset:[-180,0]});
  }
  if(window.innerWidth<=860) $('#side').classList.remove('open');
}
function bounds(p){
  const pts=[]; (p.geom||[]).forEach(g=> g.type==='polygon'?pts.push(...g.coords):pts.push(...g.coords));
  if(!pts.length) return null;
  const b = new maplibregl.LngLatBounds(pts[0],pts[0]); pts.forEach(c=>b.extend(c)); return b;
}
function openFork(f){
  $('#dTitle').textContent = f.name;
  $('#dMeta').innerHTML = `<dt>Тип</dt><dd>развилка</dd><dt>Статус</dt><dd><span style="color:${f.status==='решена'?'var(--p4)':'var(--p2)'}">${f.status}</span></dd>`;
  $('#dBody').innerHTML = obsLink(f.note) + md(f.body);
  $('#dBody').scrollTop = 0;
  wireLinks();
  $('#det').classList.add('open');
  map.easeTo({center:f.at,zoom:Math.max(map.getZoom(),12.5),duration:600,offset:[-180,0]});
}
$('#dClose').onclick = ()=>{ $('#det').classList.remove('open'); state.sel=null;
  Object.values(pins).forEach(m=>m.getElement().classList.remove('sel')); renderList(); };
document.addEventListener('keydown',e=>{ if(e.key==='Escape') $('#dClose').click(); });

/* ===== controls ===== */
function chip(label,on,color,fn){
  const b=document.createElement('button'); b.className='chip'+(on?' on':'');
  if(color) b.innerHTML = `<span class="dot" style="color:${color}"></span>${label}`; else b.textContent=label;
  if(color) b.style.color = on?color:'';
  b.onclick=()=>{ const nowOn=fn(); b.classList.toggle('on',nowOn); if(color) b.style.color = nowOn?color:''; applyFilters(); };
  return b;
}
[1,2,3,4,5].forEach(n=> $('#fPri').append(chip('П'+n,true,PRI_C[n],()=>{
  state.pri.has(n)?state.pri.delete(n):state.pri.add(n); return state.pri.has(n);})));
DATA.scenarios.forEach(s=> $('#fScen').append(chip(s,true,null,()=>{
  state.scen.has(s)?state.scen.delete(s):state.scen.add(s); return state.scen.has(s);})));
DATA.confidences.forEach(c=> $('#fConf').append(chip(c,true,null,()=>{
  state.conf.has(c)?state.conf.delete(c):state.conf.add(c); return state.conf.has(c);})));

const LAYER_UI = [
  ['districts','Районы и площадки',null],
  ['tram','Трамвайные линии','#ff5470'],
  ['rail','Ж/д и электрички','#ff9f45'],
  ['river','Преголя и работы по реке','#2d6f8c'],
  ['forks','Развилки (? / ✓)','#ffc44d'],
  ['context','Существующие пути и города',null]
];
LAYER_UI.forEach(([k,label,color])=>{
  const l=document.createElement('label'); l.className='rowtog';
  l.innerHTML = `<input type="checkbox" checked>${color?`<span class="swatch" style="border-top-color:${color}"></span>`:''}<span>${label}</span>`;
  l.querySelector('input').onchange = e=>{ state.layers[k]=e.target.checked; applyFilters(); };
  $('#layers').append(l);
});

const VIEWS = {
  city:   [[20.395,54.668],[20.632,54.752]],
  region: [[19.86,54.34],[22.02,55.14]],
  center: [[20.484,54.696],[20.540,54.724]]
};
function goto(v,dur){ map.fitBounds(VIEWS[v],{padding:{top:56,bottom:48,left:26,right:26},duration:dur===0?0:900}); }
document.querySelectorAll('#views button').forEach(b=> b.onclick=()=> goto(b.dataset.v));
goto('city',0);
$('#burger').onclick = ()=> $('#side').classList.toggle('open');
// в легенде не обещаем слоёв, которых в данных нет
const HAS = (DATA.context.has)||{};
if(!HAS.tram) $('#lgTram').hidden = true;
if(!HAS.rail) $('#lgRail').hidden = true;
