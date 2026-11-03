/* Boucles ACC : données locales indépendantes, contrôle exact des distances,
   intersection de disques pour une visualisation approchée de la zone d'ajout. */
(() => {
  'use strict';
  const KEY = window.ACC_DEMO_MODE ? 'equisolar-acc-loops-demo-v1' : 'equisolar-acc-loops-v1';
  const esc = escapeHtml;
  let loops = [];
  let storageProblem = '';
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (Array.isArray(saved)) loops = saved.filter(x => x && typeof x.id === 'string' && typeof x.name === 'string')
      .map(x => ({...x, members: Array.isArray(x.members) ? x.members : [], centres: Array.isArray(x.centres) ? x.centres : [], km: [2,10,20].includes(x.km) ? x.km : 2}));
  } catch (error) { storageProblem = 'Les boucles enregistrées ne peuvent pas être lues dans ce navigateur.'; }
  let selectedId = null, picking = null, scenarioCentre = null, candidate = null;
  let layer = null, candidateLayer = null, lastReport = null, assisted = null;
  let candidates = [], zoneMessage = '';
  const candidateKey = p => p.id !== undefined ? 'id:'+p.id : 'll:'+p.lat+','+p.lon;
  const testedSites = () => actors().concat(candidates);
  function toggleCandidate(p){
    if(actors().some(x=>candidateKey(x)===candidateKey(p)))return;
    if(isProducerMarkerHidden(p)){zoneMessage='Cette centrale est inactive : activez-la dans sa fiche pour la tester.';renderPanel();return;}
    const key=candidateKey(p),i=candidates.findIndex(x=>candidateKey(x)===key);
    if(i>=0)candidates.splice(i,1);else candidates.push(p);
    candidate=candidates.at(-1)||null;zoneMessage='';refresh();
  }
  const current = () => loops.find(x => x.id === selectedId);
  const membership = id => loops.find(x => x.members.includes(Number(id)));
  const allMembers = loop => loop.members.map(id => visiblePoints.find(p => p.id === id)).filter(Boolean)
    .concat(loop.centres.map(p => ({...p, project:p.name || p.type || 'Centre de secours', sis:true})));
  const actors = () => {
    const loop = current();
    const base = loop ? allMembers(loop) : [];
    if (scenarioCentre && !base.some(x => x.sis && x.lat === scenarioCentre.lat && x.lon === scenarioCentre.lon)) {
      base.push({...scenarioCentre, project:scenarioCentre.name || scenarioCentre.type || 'Centre de secours', sis:true, potential:true});
    }
    return base;
  };
  // Le cadre renseigné de la boucle reste la référence des acteurs engagés.
  // Pour les nouveaux candidats, retenir le seuil communal plus restrictif.
  // Le scénario SIS est une hypothèse explicite, jamais une dérogation automatique.
  const distanceLimit = () => Math.min(scenarioCentre ? 20 : current()?.km || 2,
    ...(current()?.members||[]).map(id=>Number(current()?.memberLimits?.[id])||20),
    ...candidates.map(p=>regKmForCitycode(p.citycode))) * 1000;
  const kmText = metres => (metres / 1000).toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' km';
  const dist = (a,b) => map.distance([a.lat,a.lon], [b.lat,b.lon]);
  function persist(change) {
    const before = JSON.stringify(loops);
    change();
    try { localStorage.setItem(KEY, JSON.stringify(loops)); return true; }
    catch (error) {
      loops = JSON.parse(before);
      alert('Enregistrement impossible dans ce navigateur. La modification n’a pas été conservée.');
      return false;
    }
  }
  function pairReport(sites, limit) {
    let longest = 0, pair = null;
    for (let i=0;i<sites.length;i++) for (let j=i+1;j<sites.length;j++) {
      const d = dist(sites[i],sites[j]);
      if (d > longest) { longest = d; pair = [sites[i],sites[j]]; }
    }
    return {longest, pair, ok:longest <= limit};
  }
  function actorCheck(loop, extra=[]) {
    const sites=allMembers(loop).concat(extra);
    const limit=Math.min(loop.km,...loop.members.map(id=>Number(loop.memberLimits?.[id])||20),...extra.map(p=>regKmForCitycode(p.citycode)))*1000;
    return {...pairReport(sites,limit),limit,sites};
  }
  function cloneActorDraft(loop) {
    return {members:[...(loop?.members||[])],centres:(loop?.centres||[]).map(p=>({...p})),memberLimits:{...(loop?.memberLimits||{})}};
  }
  // Sutherland-Hodgman : tous les disques sont des polygones convexes orientés dans le même sens.
  function clipConvex(subject, clip) {
    let result = subject;
    const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    for (let i=0;i<clip.length && result.length;i++) {
      const a=clip[i], b=clip[(i+1)%clip.length], input=result;
      result=[];
      let prev=input[input.length-1], pv=cross(a,b,prev);
      for (const next of input) {
        const nv=cross(a,b,next);
        if ((nv>=0) !== (pv>=0)) {
          const t=pv/(pv-nv);
          result.push([prev[0]+t*(next[0]-prev[0]),prev[1]+t*(next[1]-prev[1])]);
        }
        if(nv>=0) result.push(next);
        prev=next; pv=nv;
      }
    }
    return result;
  }
  function areaPolygon(sites, limit) {
    let result = null;
    for (const site of sites) {
      const ring=[];
      for(let i=0;i<180;i++) {
        const ll=destinationPoint({lat:site.lat,lng:site.lon}, i*2, limit);
        const pt=map.project(ll,10);
        ring.push([pt.x,pt.y]);
      }
      result=result===null ? ring : clipConvex(result,ring);
      if(!result.length) break;
    }
    return (result || []).map(p=>map.unproject(L.point(p[0],p[1]),10));
  }
  const style=document.createElement('style');
  style.textContent=`
    .management-tabs{flex-wrap:wrap}.management-tabs button{flex:1 1 120px}.management-actions-control[hidden]{display:none!important}
    .acc-loop-list{padding:6px}.acc-loop-card{border:1px solid #dce3e7;background:#fff;border-radius:14px;padding:15px;margin:10px 0}
    .acc-loop-card h3{font-size:16px;margin:0 0 7px}.acc-loop-card p{font-size:12px;color:#55616e;line-height:1.5;margin:6px 0}
    .acc-loop-buttons{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.acc-loop-buttons button{font-size:12px;min-height:36px;border-radius:10px;padding:7px 10px}
    .acc-loop-panel{position:fixed;top:78px;right:18px;width:350px;max-width:calc(100vw - 36px);max-height:calc(100dvh - 100px);overflow:auto;z-index:1250;background:rgba(255,255,255,.95);backdrop-filter:blur(16px);border:1px solid #dce3e7;border-radius:18px;padding:17px;box-shadow:0 12px 40px #17212b26;font-size:13px;line-height:1.5}
    .acc-loop-panel[hidden],.acc-loop-modal[hidden]{display:none!important}.acc-loop-panel h2{font-size:18px;margin:0}.acc-loop-panel h3{font-size:14px;margin:14px 0 6px}.acc-loop-panel p{margin:8px 0}
    .acc-loop-panel .acc-close{float:right;border:0;background:transparent;font-size:22px;min-height:28px;padding:0 4px}
    .acc-note{color:#657280;font-size:12px}.acc-pass{color:#146c50;font-weight:700}.acc-fail{color:#b32626;font-weight:700}.acc-scenario{color:#805400;font-weight:650}
    .acc-loop-panel ul{padding-left:18px;margin:7px 0}.acc-loop-panel li{margin:6px 0}.acc-loop-panel details{margin:10px 0}.acc-loop-panel select,.acc-loop-panel input{width:100%;min-height:38px;font:inherit;margin-top:5px;border:1px solid #cbd4dc;border-radius:9px;padding:7px;background:white}
    .acc-loop-modal{position:fixed;inset:0;z-index:2200;background:#17212b66;display:flex;justify-content:center;align-items:center;padding:18px}.acc-loop-modal form{width:550px;max-width:100%;max-height:90dvh;overflow:auto;background:white;padding:24px;border-radius:18px;box-shadow:0 20px 70px #17212b33}
    .acc-loop-modal h2{font-size:21px;margin:0 0 12px}.acc-loop-modal label{display:block;font-size:13px;margin:13px 0}.acc-loop-modal input,.acc-loop-modal select,.acc-loop-modal textarea{display:block;width:100%;min-height:40px;margin-top:5px;border:1px solid #cbd4dc;border-radius:9px;padding:9px;font:inherit;background:#fff}.acc-loop-modal textarea{min-height:65px;resize:vertical}
    .acc-param-actors{border:1px solid #dce7e6;border-radius:14px;padding:14px;margin:15px 0;background:#f7faf9}.acc-param-actors h3{margin:0 0 9px;font-size:16px}.acc-param-actors ul{padding:0;margin:8px 0;list-style:none;max-height:210px;overflow:auto}.acc-param-actors li{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid #e1e9e7}.acc-param-actors li span{min-width:0;overflow-wrap:anywhere}.acc-param-actors button{min-height:36px;padding:6px 10px;flex-shrink:0}.acc-param-status{margin:10px 0;font-size:13px;line-height:1.5}.acc-param-status:empty,.acc-param-error:empty{display:none}.acc-param-error{color:#b32626;font-size:13px;margin-top:10px}
    .acc-add-choices{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}.acc-add-choices button[aria-pressed=true]{background:#183934;color:white}.acc-new-fields{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}.acc-new-fields label:first-child,.acc-new-fields label:nth-child(2){grid-column:1/-1}.acc-param-actors button:disabled{opacity:.45;cursor:not-allowed}.acc-param-actors .acc-new-note{font-size:12px;line-height:1.5;padding:9px;border-radius:8px;background:#edf4f2}.acc-loop-modal [data-param-notice]:empty{display:none}@media(max-width:480px){.acc-new-fields{grid-template-columns:1fr}}
    .acc-map-name{white-space:nowrap;background:#fff;border:2px solid var(--loop-color);border-radius:8px;padding:3px 7px;color:#17212b;font-size:11px;box-shadow:0 2px 8px #0002}
    .acc-loop-panel button.primary,.acc-loop-card button.primary{background:#17212b;color:white}
    .acc-zone-handle{display:flex!important;align-items:center;justify-content:center;border:2px solid #007c83;border-radius:50%;background:white;color:#007c83;box-shadow:0 2px 8px #0003;cursor:move;touch-action:none;font-size:17px}
    .acc-loop-panel{width:320px;font-size:12px;max-height:calc(100dvh - 100px)}
    .acc-loop-panel .acc-candidate-chip{display:flex;justify-content:space-between;gap:8px;align-items:center;margin:5px 0;padding:6px 8px;background:#f1f6f5;border-radius:9px}
    .acc-loop-panel .acc-candidate-chip button{font-size:11px;min-height:28px;padding:3px 6px}
    @media(max-width:700px){.acc-loop-panel{top:auto;bottom:20px;right:10px;width:calc(100vw - 20px);max-height:42dvh;padding:12px}}
    @media(max-width:700px){.acc-loop-panel{right:10px;width:calc(100vw - 20px);max-width:none;top:74px;max-height:65dvh}.acc-loop-modal form{padding:18px}.acc-loop-panel button{min-height:40px}}
    @media(max-width:700px){.acc-loop-panel{top:auto;bottom:20px;max-height:42dvh;padding:12px}}
  `;
  document.head.append(style);
  const tab=document.createElement('button');
  tab.id='loopsTab'; tab.type='button'; tab.setAttribute('role','tab'); tab.textContent='Boucles d’ACC';
  producerTab.parentElement.append(tab);
  tab.addEventListener('click',()=>setManagementTab('loops'));
  const panel=document.createElement('section');
  panel.className='acc-loop-panel'; panel.hidden=true; panel.setAttribute('aria-label','Étude de la boucle ACC'); panel.setAttribute('aria-live','polite');
  document.body.append(panel);
  const modal=document.createElement('div'); modal.className='acc-loop-modal'; modal.hidden=true;
  modal.innerHTML=`<form role="dialog" aria-modal="true" aria-labelledby="accLoopTitle">
    <h2 id="accLoopTitle">Créer une boucle d’ACC</h2>
    <section class="acc-param-actors" aria-label="Acteurs et test de distance" data-param-actors></section>
    <label>Dénomination *<input name="name" required maxlength="150"></label>
    <label>PMO<input name="pmo" maxlength="200"></label>
    <label>Date de création<input name="date" type="date"></label>
    <label>Distance maximale entre deux participants<select name="km"><option value="2">2 km</option><option value="10">10 km</option><option value="20">20 km</option></select></label>
    <label>Cadre de cette distance<select name="basis"><option value="study">Hypothèse à vérifier</option><option value="recorded">Cadre applicable renseigné pour cette boucle</option></select></label>
    <label>Possibilité liée à un service d’incendie et de secours<select name="sis"><option value="study">À étudier</option><option value="none">Non envisagée</option><option value="confirmed">Participation SIS confirmée</option></select></label>
    <label>Notes sur la distance et les éventuelles dérogations<textarea name="notes" maxlength="2000"></textarea></label>
    <label>Couleur<input name="color" type="color" value="#007c83"></label>
    <p class="acc-note">Le test vérifiera les distances à partir des coordonnées disponibles. Les conditions du cadre choisi et les points de livraison ou d’injection restent à confirmer.</p>
    <p class="acc-param-error" role="alert" data-param-error></p>
    <div class="acc-loop-buttons"><button type="submit" class="primary">Enregistrer la boucle</button><button type="button" data-cancel>Annuler</button></div>
  </form>`;
  document.body.append(modal);
  let editingId=null, actorDraft=null, paramCandidateId='', paramTestedId=null;
  let paramAddOpen=false,paramAddMode='existing',paramNotice='',newActorValues={},newActorKind='consumer',newActorPreview=null,newActorError='',newActorBusy=false,newActorEpoch=0;
  const form=modal.querySelector('form');
  function cancelNewActorRequest(){
    newActorEpoch++;newActorBusy=false;newActorPreview=null;
  }
  modal.querySelector('[data-cancel]').onclick=()=>{cancelNewActorRequest();modal.hidden=true;};
  modal.addEventListener('click',e=>{if(e.target===modal){cancelNewActorRequest();modal.hidden=true;}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape') {cancelNewActorRequest();modal.hidden=true;picking=null;renderPanel();}});
  form.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.closest('[data-new-actor]')&&e.target.tagName!=='BUTTON'){e.preventDefault();if(!newActorBusy)prepareNewActor();}});
  function editLoop(id=null) {
    editingId=id; const x=loops.find(x=>x.id===id);
    form.reset();
    for(const name of ['name','pmo','date','km','basis','sis','notes','color']) if(x && x[name] !== undefined)form.elements.namedItem(name).value=x[name];
    actorDraft=cloneActorDraft(x);paramCandidateId='';paramTestedId=null;
    cancelNewActorRequest();paramAddOpen=false;paramAddMode='existing';paramNotice='';newActorValues={};newActorKind='consumer';newActorError='';
    form.querySelector('[data-param-error]').textContent='';renderParamActors();
    document.getElementById('accLoopTitle').textContent=x?'Modifier la boucle':'Créer une boucle d’ACC';
    modal.hidden=false;form.elements.namedItem('name').focus();
  }
  form.onsubmit=e=>{
    e.preventDefault();if(newActorBusy){form.querySelector('[data-param-error]').textContent='Attendez la fin de la localisation du site.';return;}const data=new FormData(form); const name=String(data.get('name')).trim();if(!name)return;
    const old=loops.find(x=>x.id===editingId);
    const x={...old,id:old?.id||'loop-'+crypto.randomUUID(),name,pmo:String(data.get('pmo')).trim(),date:String(data.get('date')),km:Number(data.get('km')),basis:String(data.get('basis')),sis:String(data.get('sis')),notes:String(data.get('notes')).trim(),color:String(data.get('color')),...cloneActorDraft(actorDraft)};
    const additions=x.members.filter(id=>!old?.members.includes(id));
    if(additions.some(id=>{const p=visiblePoints.find(p=>p.id===id),assigned=membership(id);return !p||isProducerMarkerHidden(p)||(assigned&&assigned.id!==editingId);})){
      form.querySelector('[data-param-error]').textContent='Un site ajouté est indisponible, inactif ou déjà affecté à une autre boucle. Vérifiez la liste des acteurs.';return;
    }
    if(additions.length&&!actorCheck(x).ok){form.querySelector('[data-param-error]').textContent='Ajout non enregistré : les distances dépassent la limite. Retirez le site incompatible ou corrigez le cadre de distance.';return;}
    if(!persist(()=>{if(old)loops[loops.indexOf(old)]=x;else loops.push(x);}))return;
    modal.hidden=true;render();refresh();
  };
  function draftLoop(){return {id:editingId,km:Number(form.elements.namedItem('km').value),...actorDraft};}
  function reportText(report){
    return (report.ok?'Distances compatibles':'Distances non compatibles')+' · limite '+kmText(report.limit)+
      (report.pair?' · '+(report.pair[0].project||report.pair[0].address||'Site')+' ↔ '+(report.pair[1].project||report.pair[1].address||'Site')+' : '+kmText(report.longest):'');
  }
  function renderParamActors(){
    if(!actorDraft)return;
    const section=form.querySelector('[data-param-actors]'),loop=draftLoop();
    const entries=loop.members.map(id=>({id,p:visiblePoints.find(p=>p.id===id)}));
    const available=visiblePoints.filter(p=>!loop.members.includes(p.id)&&!isProducerMarkerHidden(p)&&(!membership(p.id)||membership(p.id).id===editingId)).slice().sort((a,b)=>a.project.localeCompare(b.project,'fr'));
    if(!available.some(p=>String(p.id)===paramCandidateId)){paramCandidateId='';paramTestedId=null;}
    const picked=available.find(p=>String(p.id)===paramCandidateId);
    const test=picked&&paramTestedId===paramCandidateId?actorCheck(loop,[picked]):null;
    const report=actorCheck(loop);
    section.innerHTML=`<h3>Acteurs de la boucle (${loop.members.length+loop.centres.length})</h3>
      <p class="acc-note">Ajouts et retraits appliqués uniquement avec « Enregistrer la boucle ». Retirer un acteur ne supprime pas son site de la carte.</p>
      <ul>${entries.map(({id,p})=>`<li><span><strong>${esc(p?.project||'Site enregistré #'+id)}</strong><br><small>${esc(p?p.imported?'Consommateur':'Producteur':'Fiche introuvable')}${p&&isProducerMarkerHidden(p)?' · inactive':''} · ${esc(p?.address||'Adresse non renseignée')}</small></span><button type="button" data-param-remove="${id}" aria-label="Retirer ${esc(p?.project||'le site '+id)} de la boucle">Retirer</button></li>`).join('')}
      ${loop.centres.map((p,i)=>`<li><span><strong>${esc(p.name||p.type||'Centre de secours')}</strong><br><small>Centre de secours · ${esc(p.address||p.city||'Adresse non renseignée')}</small></span><button type="button" data-param-centre="${i}" aria-label="Retirer ${esc(p.name||p.type||'ce centre')} de la boucle">Retirer</button></li>`).join('')}</ul>
      ${!loop.members.length&&!loop.centres.length?'<p>Aucun acteur pour le moment.</p>':''}
      <p class="acc-param-status ${report.ok?'acc-pass':'acc-fail'}">${esc(reportText(report))}</p>
      <p class="acc-new-note" role="status" data-param-notice>${esc(paramNotice)}</p>
      <button type="button" data-param-open aria-expanded="${paramAddOpen}">${paramAddOpen?'Fermer l’ajout':'Ajouter un acteur'}</button>
      <div data-param-workflow ${paramAddOpen?'':'hidden'}>
      <div class="acc-add-choices" role="group" aria-label="Comment ajouter l’acteur"><button type="button" data-param-mode="existing" aria-pressed="${paramAddMode==='existing'}">Choisir un site existant</button><button type="button" data-param-mode="new" aria-pressed="${paramAddMode==='new'}">Créer un nouveau site</button></div>
      <div ${paramAddMode==='existing'?'':'hidden'}>
      <label>Site à ajouter<select data-param-site><option value="">Choisir un site enregistré</option>${available.map(p=>`<option value="${p.id}" ${String(p.id)===paramCandidateId?'selected':''}>${esc(p.project)} · ${p.imported?'consommateur':'producteur'}</option>`).join('')}</select></label>
      <p role="status" aria-live="polite" class="acc-param-status ${test?(test.ok?'acc-pass':'acc-fail'):''}" data-param-result>${test?esc(reportText(test))+(test.limit<loop.km*1000?' — seuil réduit par le site testé.':''):''}</p>
      <button type="button" data-param-add ${test?.ok?'':'disabled'}>Confirmer l’ajout aux acteurs</button>
      </div>${renderNewActor(loop)}</div>
      <p class="acc-note">Le test compare toutes les paires d’acteurs, y compris les autres sites ajoutés ici. Une catégorie communale inconnue est traitée prudemment à 2 km. Le résultat porte uniquement sur la distance, pas sur l’éligibilité réglementaire complète.</p>`;
    section.querySelector('[data-param-open]').onclick=()=>{cancelNewActorRequest();paramAddOpen=!paramAddOpen;renderParamActors();};
    section.querySelectorAll('[data-param-mode]').forEach(b=>b.onclick=()=>{cancelNewActorRequest();paramAddMode=b.dataset.paramMode;newActorError='';renderParamActors();});
    section.querySelector('[data-param-site]').onchange=e=>{paramCandidateId=e.target.value;paramTestedId=paramCandidateId;renderParamActors();};
    section.querySelector('[data-param-add]').onclick=()=>{
      const p=visiblePoints.find(p=>String(p.id)===paramCandidateId),assigned=p&&membership(p.id);
      if(!p||paramTestedId!==paramCandidateId||actorDraft.members.includes(p.id)||isProducerMarkerHidden(p)||(assigned&&assigned.id!==editingId)||!actorCheck(draftLoop(),[p]).ok)return;
      actorDraft.members.push(p.id);actorDraft.memberLimits[p.id]=regKmForCitycode(p.citycode);paramCandidateId='';paramTestedId=null;paramAddOpen=false;paramNotice='Acteur préparé : '+p.project+'. Cliquez sur « Enregistrer la boucle » pour confirmer le rattachement.';renderParamActors();
    };
    section.querySelectorAll('[data-param-remove]').forEach(b=>b.onclick=()=>{
      const id=Number(b.dataset.paramRemove);actorDraft.members=actorDraft.members.filter(x=>x!==id);delete actorDraft.memberLimits[id];paramTestedId=null;renderParamActors();
    });
    section.querySelectorAll('[data-param-centre]').forEach(b=>b.onclick=()=>{actorDraft.centres.splice(Number(b.dataset.paramCentre),1);paramTestedId=null;renderParamActors();});
    bindNewActor(section);
  }
  form.elements.namedItem('km').addEventListener('change',()=>{paramTestedId=paramCandidateId;renderParamActors();});
  function newActorFields(){
    return [['address','Adresse complète *'],['project','Nom du site'],...(newActorKind==='producer'?[['spv','Société / SPV'],['annualKwh','Production annuelle (kWh)'],['tariff','Tarif de vente (€/MWh)']]:[['consumptionKwh','Consommation globale (kWh)'],['tariff','Tarif moyen global (€/MWh)'],['consumptionProductionHoursKwh','Consommation pendant les heures de production (kWh)'],['tariffProductionHours','Tarif pendant les heures de production (€/MWh)'],['consumptionOffHoursKwh','Consommation hors heures de production (kWh)'],['tariffOffHours','Tarif hors heures de production (€/MWh)']])];
  }
  function renderNewActor(loop){
    const report=newActorPreview?actorCheck(loop,[newActorPreview]):null;
    return `<div data-new-actor ${paramAddMode==='new'?'':'hidden'}><label>Type de site<select data-new-kind ${newActorBusy?'disabled':''}><option value="consumer" ${newActorKind==='consumer'?'selected':''}>Site consommateur</option><option value="producer" ${newActorKind==='producer'?'selected':''}>Centrale productrice</option></select></label>
      <div class="acc-new-fields">${newActorFields().map(([key,label])=>`<label>${esc(label)}<input data-new-field="${key}" name="actorNew_${key}" value="${esc(newActorValues[key]||'')}" ${newActorBusy?'disabled':''} ${['address','project','spv'].includes(key)?'':'inputmode="decimal"'}></label>`).join('')}</div>
      <p class="acc-note">Seule l’adresse est obligatoire. Les consommations et productions sont en kWh, les tarifs en €/MWh.</p>
      <button type="button" data-new-prepare ${newActorBusy?'disabled':''}>${newActorBusy?'Localisation en cours…':'Localiser et vérifier les distances'}</button>
      <p class="acc-param-error" role="alert" data-new-error>${esc(newActorError)}</p>
      <div data-new-preview ${newActorPreview?'':'hidden'}>
        <p role="status" class="acc-param-status ${report?.ok?'acc-pass':'acc-fail'}">${report?esc(reportText(report)):''}</p>
        <p class="acc-new-note">La fiche sera enregistrée dans « Sites ${newActorKind==='producer'?'producteurs':'consommateurs'} ». Le rattachement à la boucle ne sera enregistré qu’avec « Enregistrer la boucle ». Annuler la boucle ne supprimera pas la fiche créée.</p>
        <div class="acc-loop-buttons"><button type="button" data-new-commit="attach" ${report?.ok?'':'disabled'}>Créer et préparer le rattachement</button><button type="button" data-new-commit="site" ${newActorPreview?'':'disabled'}>Créer le site sans le rattacher</button></div>
        ${report&&!report.ok?'<p class="acc-note">Ce site ne respecte pas les distances de cette boucle. Vous pouvez conserver sa fiche sur la carte sans l’y rattacher.</p>':''}
      </div></div>`;
  }
  function bindNewActor(section){
    section.querySelector('[data-new-kind]').onchange=e=>{cancelNewActorRequest();newActorKind=e.target.value;newActorError='';renderParamActors();};
    section.querySelectorAll('[data-new-field]').forEach(input=>input.oninput=()=>{
      newActorValues[input.dataset.newField]=input.value;newActorPreview=null;newActorError='';newActorEpoch++;
      section.querySelector('[data-new-preview]').hidden=true;section.querySelector('[data-new-error]').textContent='';
      section.querySelectorAll('[data-new-commit]').forEach(b=>b.disabled=true);
    });
    section.querySelector('[data-new-prepare]').onclick=prepareNewActor;
    section.querySelectorAll('[data-new-commit]').forEach(b=>b.onclick=()=>commitNewActor(b.dataset.newCommit==='attach'));
  }
  function actorDuplicate(p){
    return visiblePoints.find(x=>normHeader(x.project||x.address)===normHeader(p.project||p.address)&&
      (canonicalAddress(x.address)===canonicalAddress(p.address)||canonicalAddress(x.matched||x.address)===canonicalAddress(p.matched||p.address)));
  }
  function parseNewActor(){
    const address=String(newActorValues.address||'').trim();if(!address)throw Error('Renseignez une adresse complète.');
    const point={address,project:String(newActorValues.project||'').trim()||address,spv:String(newActorValues.spv||'').trim()||'Ajout manuel'};
    for(const [key,label] of newActorFields().filter(([key])=>!['address','project','spv'].includes(key))){
      const raw=String(newActorValues[key]||'').trim(),n=raw?parseCsvNumber(raw):null;
      if(raw&&(!Number.isFinite(n)||n<0))throw Error(label+' : saisissez un nombre positif.');
      point[key]=n!==null&&key.startsWith('tariff')?tariffInternalFromMwh(n):n;
    }
    return point;
  }
  async function prepareNewActor(){
    if(newActorBusy||!actorDraft||modal.hidden)return;
    let p;try{p=parseNewActor();if(actorDuplicate(p))throw Error('Ce site existe déjà. Choisissez-le dans « Choisir un site existant » pour éviter un doublon.');}
    catch(error){newActorError=error.message;newActorPreview=null;renderParamActors();return;}
    const epoch=++newActorEpoch;newActorBusy=true;newActorPreview=null;newActorError='';renderParamActors();
    try{
      const found=await geocodeAddress(p.address);
      if(epoch!==newActorEpoch||modal.hidden)return;
      if(!found||found.rejected||!Number.isFinite(found.lat)||!Number.isFinite(found.lon))throw Error('Adresse introuvable ou trop imprécise. Complétez le numéro, la rue, le code postal et la ville.');
      const located={...p,lat:found.lat,lon:found.lon,citycode:found.citycode||null,matched:found.label||p.address,city:found.city||''};
      if(actorDuplicate(located))throw Error('Ce site existe déjà à cette adresse. Choisissez sa fiche existante.');
      newActorPreview=located;
    }catch(error){if(epoch===newActorEpoch)newActorError=error.message||'La localisation a échoué. Vérifiez votre connexion.';}
    finally{if(epoch===newActorEpoch){newActorBusy=false;renderParamActors();}}
  }
  function commitNewActor(attach){
    if(!newActorPreview||newActorBusy||modal.hidden)return;
    if(actorDuplicate(newActorPreview)){newActorError='Ce site existe déjà : aucune nouvelle fiche créée.';renderParamActors();return;}
    if(attach&&!actorCheck(draftLoop(),[newActorPreview]).ok){newActorError='Le test de distance ne permet pas le rattachement.';renderParamActors();return;}
    const p=newActorKind==='producer'?{...newActorPreview,id:nextSavedId--,manual:true,source:'ajout-manuel',accStatus:null,accAllocatedKwh:null,color:'#d83b35'}:
      {...newActorPreview,id:nextImportId+=1,imported:true,spv:'Site consommateur',consumerOrigin:'manual',source:'consumer-manual',kwc:null,color:'#7c3aed'};
    visiblePoints.push(p);
    const saved=newActorKind==='producer'?saveSavedAddressChanges():saveImportedPoints();
    if(!saved){visiblePoints.splice(visiblePoints.indexOf(p),1);newActorError='Enregistrement impossible dans ce navigateur. Aucune fiche créée ni rattachée. Libérez du stockage puis réessayez.';renderParamActors();return;}
    if(attach){actorDraft.members.push(p.id);actorDraft.memberLimits[p.id]=regKmForCitycode(p.citycode);}
    paramNotice='Fiche créée : '+p.project+'. '+(attach?'Cliquez sur « Enregistrer la boucle » pour confirmer son rattachement.':'Elle reste sur la carte sans rattachement à cette boucle.');
    newActorPreview=null;newActorValues={};newActorError='';paramAddOpen=false;paramAddMode='existing';paramCandidateId='';paramTestedId=null;
    rebuildAddressMarkers();document.getElementById('addressCount').textContent=visiblePoints.length;updateCircleStatus();renderList();renderManagementList();renderParamActors();
  }
  function syncTab(){
    tab.classList.toggle('active',managementTab==='loops');tab.setAttribute('aria-selected',String(managementTab==='loops'));
    document.querySelector('.management-actions-control').hidden=managementTab==='loops';
  }
  function confirmAction(message, action){
    const box=document.createElement('div');box.className='acc-loop-modal';
    const content=document.createElement('form');content.setAttribute('role','dialog');content.setAttribute('aria-modal','true');content.setAttribute('aria-label','Confirmer la modification de la boucle');
    const text=document.createElement('p');text.textContent=message;
    const buttons=document.createElement('div');buttons.className='acc-loop-buttons';
    const yes=document.createElement('button');yes.type='submit';yes.textContent='Confirmer';
    const no=document.createElement('button');no.type='button';no.textContent='Annuler';no.onclick=()=>box.remove();
    buttons.append(yes,no);content.append(text,buttons);box.append(content);document.body.append(box);
    content.onsubmit=e=>{e.preventDefault();box.remove();action();};no.focus();
    box.addEventListener('keydown',e=>{if(e.key==='Escape')box.remove();});
  }
  function render(){
    if(managementTab!=='loops'||managementPanel.hidden)return;
    managementList.innerHTML=`<div class="acc-loop-list"><div class="acc-loop-buttons"><button type="button" class="primary" data-create>Créer une boucle</button></div>
      <p class="acc-note">Boucles enregistrées dans ce navigateur. Affectez les sites depuis leurs fiches ou depuis la liste des acteurs de la boucle.</p>
      ${storageProblem?`<p class="acc-fail">${esc(storageProblem)}</p>`:''}
      ${loops.length?loops.slice().sort((a,b)=>a.name.localeCompare(b.name,'fr')).map(x=>`<article class="acc-loop-card" style="border-left:4px solid ${esc(x.color)}"><h3>${esc(x.name)}</h3><p>${esc(x.pmo||'PMO non renseignée')} · ${allMembers(x).length} acteur(s) · ${x.km} km</p><p>${x.date?'Créée le '+esc(x.date):'Date non renseignée'} · SIS : ${x.sis==='confirmed'?'participation confirmée':x.sis==='none'?'non envisagé':'à étudier'}</p><div class="acc-loop-buttons"><button type="button" data-show="${esc(x.id)}" class="primary">Voir et tester</button><button type="button" data-edit="${esc(x.id)}">Paramètres</button><button type="button" data-delete="${esc(x.id)}">Supprimer</button></div></article>`).join(''):'<p>Aucune boucle enregistrée. Créez la première avec vos données.</p>'}</div>`;
    managementList.querySelector('[data-create]').onclick=()=>editLoop();
    managementList.querySelectorAll('[data-show]').forEach(b=>b.onclick=()=>show(b.dataset.show));
    managementList.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editLoop(b.dataset.edit));
    managementList.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{
      confirmAction('Supprimer cette boucle et ses affectations ? Les sites eux-mêmes seront conservés.',()=>{
        if(persist(()=>{loops=loops.filter(x=>x.id!==b.dataset.delete);})){if(selectedId===b.dataset.delete)closeStudy();render();}
      });
    });
  }
  function show(id){
    selectedId=id;picking=null;scenarioCentre=null;candidate=null;lastReport=null;candidates=[];zoneMessage='';assisted?.clear();
    setManagementOpen(false);hideCircle();draw(true);renderPanel();
  }
  function closeStudy(){selectedId=null;picking=null;scenarioCentre=null;candidate=null;candidates=[];panel.hidden=true;assisted?.clear();layer?.clearLayers();candidateLayer?.clearLayers();}
  function draw(fit=false){
    if(!map)return;
    if(!layer)layer=L.layerGroup().addTo(map);
    if(!candidateLayer)candidateLayer=L.layerGroup().addTo(map);
    layer.clearLayers();candidateLayer.clearLayers();
    const loop=current();if(!loop)return;
    const sites=actors();const color=loop.color||'#007c83';
    if(!assisted)assisted=new AccAssistedZone(map,message=>{zoneMessage=message;const el=panel.querySelector('[data-zone-message]');if(el)el.textContent=message;});
    assisted.update(testedSites(),distanceLimit(),color,p=>visiblePoints.filter(x=>!isProducerMarkerHidden(x)).some(x=>map.latLngToContainerPoint([x.lat,x.lon]).distanceTo(map.latLngToContainerPoint([p.lat,p.lon]))<16));
    sites.forEach(p=>{
      L.circleMarker([p.lat,p.lon],{radius:p.potential?12:10,color,weight:3,fillColor:'#fff',fillOpacity:.8,interactive:false,dashArray:p.potential?'4 4':null}).addTo(layer);
    });
    const report=pairReport(testedSites(),distanceLimit());
    candidates.forEach(p=>{
      const marker=L.circleMarker([p.lat,p.lon],{renderer:L.svg(),radius:12,color:report.ok?'#14805d':'#c0392b',weight:3,fillOpacity:.35,bubblingMouseEvents:false}).addTo(candidateLayer);
      marker.bindTooltip(esc(p.project||p.address)+' · testé');marker.on('click',()=>toggleCandidate(p));
    });
    if(!report.ok&&report.pair)L.polyline(report.pair.map(p=>[p.lat,p.lon]),{color:'#c0392b',dashArray:'5 6',weight:2,interactive:false}).addTo(candidateLayer);
    if(fit&&sites.length){const bounds=assisted.bounds()||L.latLngBounds(testedSites().map(p=>[p.lat,p.lon])).pad(.5);map.fitBounds(bounds,{maxZoom:13,paddingTopLeft:[65,85],paddingBottomRight:innerWidth>700?[355,60]:[30,300]});}
  }
  function reportCandidate(p){
    const sites=actors(), limit=distanceLimit();let farthest=null,max=0;
    for(const site of sites){const d=dist(site,p);if(d>max){max=d;farthest=site;}}
    const existing=pairReport(sites,limit);
    return {ok:sites.length>0&&max<=limit&&existing.ok,max,farthest,existing};
  }
  function candidateReport(){
    if(!candidates.length)return '';
    const report=pairReport(testedSites(),distanceLimit());
    return `<h3>Sites testés (${candidates.length})</h3><p class="${report.ok?'acc-pass':'acc-fail'}">${report.ok?'Distances compatibles ensemble':'Ensemble non compatible'}</p>
      ${report.pair?`<p>${esc(report.pair[0].project||report.pair[0].address)} ↔ ${esc(report.pair[1].project||report.pair[1].address)} : <strong>${kmText(report.longest)}</strong> / ${distanceLimit()/1000} km.</p>`:''}
      ${!report.ok?'<p class="acc-note">Zone suspendue. Retirez un candidat pour revenir à une configuration compatible.</p>':''}
      ${candidates.map(p=>`<div class="acc-candidate-chip"><span>${esc(p.project||p.address)}${p.id!==undefined&&membership(p.id)?'<br><small>Déjà affecté à '+esc(membership(p.id).name)+'</small>':''}</span><span><button type="button" data-untest="${esc(candidateKey(p))}">Retirer du test</button>${report.ok&&!scenarioCentre&&p.id!==undefined&&!membership(p.id)?`<button type="button" data-enrol="${esc(candidateKey(p))}">Ajouter à la boucle</button>`:''}</span></div>`).join('')}
      <button type="button" data-clear-tests>Vider les essais</button><p class="acc-note">Essais temporaires : aucun de ces sites n’est ajouté automatiquement à la boucle. Le contrôle porte uniquement sur les distances.</p>`;
  }
  function renderPanel(){
    const loop=current();if(!loop){panel.hidden=true;return;}
    panel.hidden=false;const sites=actors(),report=map?pairReport(testedSites(),distanceLimit()):null;
    if(picking==='centre'){
      panel.innerHTML=`<h2>${esc(loop.name)}</h2><p class="acc-scenario">${picking==='centre'?'Cliquez sur un triangle orange individuel. Zoomez si les centres sont regroupés.':'Cliquez sur un site sur la carte ou recherchez une adresse dans la barre du haut.'}</p><button type="button" data-cancel-pick>Annuler le test</button>`;
      panel.querySelector('[data-cancel-pick]').onclick=()=>{picking=null;renderPanel();};
      return;
    }
    const assigned=allMembers(loop);
    const unassigned=visiblePoints.filter(p=>!membership(p.id)).sort((a,b)=>a.project.localeCompare(b.project,'fr'));
    panel.innerHTML=`<button type="button" class="acc-close" aria-label="Fermer l’étude de boucle" data-close>×</button><h2>${esc(loop.name)}</h2>
      <p>${esc(loop.pmo||'PMO non renseignée')} · ${loop.date?esc(loop.date):'Date non renseignée'}</p>
      <p><strong>${distanceLimit()/1000} km entre participants</strong><br><span class="acc-note">${scenarioCentre?'Scénario avec un centre potentiel':loop.basis==='recorded'?'Cadre de la boucle renseigné par vos soins':'Hypothèse de distance à vérifier'}${distanceLimit()<loop.km*1000?' · seuil réduit par un site testé':''}</span></p>
      ${candidates.some(p=>!p.citycode||communeDens7(p.citycode)===undefined)?'<p class="acc-note">Au moins une catégorie communale est inconnue : seuil prudent de 2 km appliqué pour ce test.</p>':''}
      ${scenarioCentre?`<p class="acc-scenario">Scénario 20 km avec ${esc(scenarioCentre.name||scenarioCentre.type)}. Ce centre n’est pas engagé ni ajouté automatiquement.</p><button type="button" data-stop-scenario>Revenir à la boucle</button>`:''}
      ${loop.notes?`<p class="acc-note">${esc(loop.notes)}</p>`:''}
      ${sites.length?`<p class="${report.ok?'acc-pass':'acc-fail'}">${report.ok?'Distances compatibles avec cette limite':'La distance entre sites dépasse la limite'}</p><p>Glissez la zone translucide ou tirez une poignée. Les ${sites.length} acteurs restent fixes. Cliquez sur plusieurs sites pour les tester ensemble.</p><p class="acc-note" data-zone-message aria-live="polite">${esc(zoneMessage||'Le contour est une enveloppe d’exploration, pas l’ensemble de tous les sites éligibles.')}</p>`:'<p>Cette boucle n’a pas encore d’acteurs. Ajoutez un premier site ci-dessous.</p>'}
      <div class="acc-loop-buttons"><button type="button" data-test class="primary">Tester des sites</button><button type="button" data-fit>Centrer</button><button type="button" data-reset-zone>Réinitialiser la zone</button></div>
      <details><summary>Options de la boucle</summary><div class="acc-loop-buttons"><button type="button" data-scenario>Étudier avec un centre</button><button type="button" data-params>Paramètres</button></div></details>
      ${picking?`<p class="acc-scenario">${picking==='centre'?'Cliquez sur un triangle orange individuel. Zoomez si les centres sont regroupés.':'Cliquez sur un site sur la carte ou recherchez une adresse dans la barre du haut.'}</p><button type="button" data-cancel-test>Annuler le test</button>`:''}
      <label>Ajouter un site au test<select data-candidate><option value="">Sélectionner un site enregistré</option>${visiblePoints.filter(p=>!isProducerMarkerHidden(p)&&!actors().some(x=>x.id===p.id)&&!candidates.some(x=>x.id===p.id)).sort((a,b)=>a.project.localeCompare(b.project,'fr')).map(p=>`<option value="${p.id}">${esc(p.project)}</option>`).join('')}</select></label>
      ${candidateReport()}
      <details ${!sites.length?'open':''}><summary>Acteurs de la boucle (${assigned.length})</summary>
      ${assigned.length?`<ul>${assigned.map(p=>`<li>${esc(p.project)}<br><span class="acc-note">${p.sis?'Centre de secours':p.imported?'Consommateur':'Producteur'}${isProducerMarkerHidden(p)?' · centrale inactive':''} · ${esc(p.address||p.city||'Adresse non renseignée')}</span><button type="button" data-remove="${p.sis?'sis:'+loop.centres.findIndex(c=>c.lat===p.lat&&c.lon===p.lon):p.id}">Retirer</button></li>`).join('')}</ul>`:'<p>Aucun acteur.</p>'}
      <label>Ajouter un acteur enregistré<select data-member><option value="">Choisir un site</option>${unassigned.map(p=>`<option value="${p.id}">${esc(p.project)} · ${p.imported?'consommateur':'producteur'}</option>`).join('')}</select></label><button type="button" data-add-member>Ajouter cet acteur</button>
      <p class="acc-note">Cette liste décrit les participants enregistrés. Ajouter un acteur ici ne valide pas son éligibilité. Une centrale inactive reste une contrainte géographique si elle est enregistrée comme participante ; sa production reste exclue des simulations.</p></details>
      ${scenarioCentre?'<div class="acc-loop-buttons"><button type="button" data-add-centre>Enregistrer ce centre comme acteur</button></div>':''}
      <p class="acc-note">Contrôle des distances uniquement, selon le cadre renseigné. Ce test ne valide pas les autres conditions réglementaires. Modifications conservées dans ce navigateur.</p>`;
    panel.querySelector('[data-close]').onclick=closeStudy;
    panel.querySelector('[data-params]').onclick=()=>editLoop(loop.id);
    panel.querySelector('[data-fit]').onclick=()=>draw(true);
    panel.querySelector('[data-reset-zone]').onclick=()=>{assisted?.reset();zoneMessage='';refresh();};
    panel.querySelector('[data-test]').onclick=()=>{picking='site';zoneMessage='Cliquez sur les sites à tester, ou recherchez une adresse. Les essais ne modifient pas la boucle.';setManagementOpen(false);renderPanel();};
    panel.querySelector('[data-scenario]').onclick=()=>{
      picking='centre';setManagementOpen(false);
      if(!cisVisible){toggleCisButton.click();}
      renderPanel();
    };
    panel.querySelector('[data-stop-scenario]')?.addEventListener('click',()=>{scenarioCentre=null;candidate=null;picking=null;refresh();});
    panel.querySelector('[data-cancel-test]')?.addEventListener('click',()=>{picking=null;renderPanel();});
    panel.querySelector('[data-candidate]').onchange=e=>{
      const p=visiblePoints.find(p=>p.id===Number(e.target.value));if(p){picking=null;toggleCandidate(p);}
    };
    panel.querySelectorAll('[data-untest]').forEach(b=>b.onclick=()=>{const p=candidates.find(x=>candidateKey(x)===b.dataset.untest);if(p)toggleCandidate(p);});
    panel.querySelectorAll('[data-enrol]').forEach(b=>b.onclick=()=>{
      const p=candidates.find(x=>candidateKey(x)===b.dataset.enrol);
      if(!p||p.id===undefined||membership(p.id)||scenarioCentre||!pairReport(testedSites(),distanceLimit()).ok)return;
      confirmAction('Ajouter « '+(p.project||p.address)+' » aux acteurs enregistrés de cette boucle ? Le test de distance ne vaut pas validation réglementaire.',()=>{
        if(membership(p.id)||!candidates.includes(p)||!pairReport(testedSites(),distanceLimit()).ok)return;
        if(persist(()=>{loop.members.push(p.id);loop.memberLimits||={};loop.memberLimits[p.id]=regKmForCitycode(p.citycode);})){candidates=candidates.filter(x=>candidateKey(x)!==candidateKey(p));refresh();render();}
      });
    });
    panel.querySelector('[data-clear-tests]')?.addEventListener('click',()=>{candidates=[];candidate=null;zoneMessage='';refresh();});
    panel.querySelector('[data-add-member]').onclick=()=>{
      const value=panel.querySelector('[data-member]').value;if(!value)return;
      const id=Number(value);if(membership(id))return;
      const p=visiblePoints.find(p=>p.id===id);if(!p||isProducerMarkerHidden(p)){alert('Activez cette centrale avant de la tester.');return;}
      const report=actorCheck(loop,[p]);if(!report.ok){alert(reportText(report)+' — acteur non ajouté.');return;}
      if(persist(()=>{loop.members.push(id);loop.memberLimits||={};loop.memberLimits[id]=regKmForCitycode(p.citycode);})){candidate=null;refresh();draw(true);render();}
    };
    panel.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{
      if(persist(()=>{if(b.dataset.remove.startsWith('sis:'))loop.centres.splice(Number(b.dataset.remove.slice(4)),1);else loop.members=loop.members.filter(id=>id!==Number(b.dataset.remove));})){refresh();render();}
    });
    panel.querySelector('[data-add-centre]')?.addEventListener('click',()=>{
      if(!scenarioCentre||!pairReport(actors(),20000).ok){alert('Les distances du scénario dépassent 20 km.');return;}
      const centre=scenarioCentre;
      confirmAction('Enregistrer ce centre comme participant de la boucle ? Cette action doit correspondre à votre connaissance du dossier. Le cadre de distance reste à renseigner dans les paramètres.',()=>{
        if(persist(()=>{if(!loop.centres.some(p=>p.lat===centre.lat&&p.lon===centre.lon))loop.centres.push({...centre});})){scenarioCentre=null;candidate=null;refresh();render();}
      });
    });
  }
  function refresh(){if(current()){
    candidates=candidates.map(p=>p.id===undefined?p:visiblePoints.find(x=>x.id===p.id)).filter(p=>p&&!actors().some(x=>candidateKey(x)===candidateKey(p))&&!isProducerMarkerHidden(p));
    draw();renderPanel();
  }}
  function pickSite(ids){
    if(!current()||picking==='centre')return false;
    const p=visiblePoints.find(p=>ids.includes(p.id));if(!p)return false;
    picking=null;toggleCandidate(p);return true;
  }
  function pickCentre(site){
    if(picking!=='centre'||!current())return;
    scenarioCentre={lat:site.lat,lon:site.lon,name:site.name||site.type,address:site.address||'',city:site.city||'',type:site.type};
    picking=null;candidate=null;map.closePopup();refresh();
  }
  function pickAddress(p){
    if(!current()||picking==='centre')return false;
    picking=null;toggleCandidate(p);map.setView([p.lat,p.lon],12);return true;
  }
  for(const target of [editCentralForm,consumerForm,addressForm]){
    const label=document.createElement('label');label.textContent='Boucle d’ACC de rattachement';
    const select=document.createElement('select');select.name='accLoopId';label.append(select);
    target.querySelector('.address-form-grid').append(label);
    const note=document.createElement('p');note.className='acc-note';note.textContent='L’affectation identifie la boucle ; elle ne remplace pas le volume de production affecté ni le contrôle des distances.';label.append(note);
  }
  function fillSiteForm(target,point){
    const select=target.elements.namedItem('accLoopId');
    select.innerHTML='<option value="">Aucune boucle</option>'+loops.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
    select.value=point?membership(point.id)?.id||'':'';
  }
  function saveSiteForm(target,point){
    if(!point)return;
    const id=target.elements.namedItem('accLoopId').value;
    persist(()=>{
      loops.forEach(x=>{x.members=x.members.filter(member=>member!==point.id);});
      const x=loops.find(x=>x.id===id);if(x)x.members.push(point.id);
    });
    refresh();
  }
  function forgetSites(ids){
    const removed=new Set(ids);
    if(loops.some(x=>x.members.some(id=>removed.has(id))))persist(()=>loops.forEach(x=>{x.members=x.members.filter(id=>!removed.has(id));}));
    if(candidate&&removed.has(candidate.id))candidate=null;
    candidates=candidates.filter(p=>!removed.has(p.id));
    refresh();
  }
  window.AccLoops={syncTab,render,refresh,pickSite,pickCentre,pickAddress,fillSiteForm,saveSiteForm,forgetSites,closeStudy,show};
  syncTab();
})();
