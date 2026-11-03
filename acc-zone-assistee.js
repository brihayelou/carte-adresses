/* Zone manipulable : aucune écriture des données des sites ou des boucles. */
(() => {
  'use strict';
  const G=window.DemoZoneGeometry;
  const electricStyle=document.createElement('style');
  electricStyle.textContent=`
    .acc-electric-pulse,.acc-electric-halo,.acc-electric-spark{fill:none;pointer-events:none;stroke-linecap:round;stroke-linejoin:round}
    /* Décharges monochromes sur un périmètre stable. */
    .acc-electric-halo{opacity:.22;filter:blur(2px)}
    .acc-electric-pulse{opacity:.9}
    .acc-electric-spark{opacity:.45}
    @media(prefers-reduced-motion:reduce){.acc-electric-pulse,.acc-electric-halo,.acc-electric-spark{animation:none;opacity:0}}
  `;
  document.head.append(electricStyle);
  class AccAssistedZone {
    constructor(map,onStatus){
      this.map=map;this.onStatus=onStatus;this.handles=[];this.signature='';
      const pane=map.getPane('accAssistedZone')||map.createPane('accAssistedZone');pane.style.zIndex='350';
      this.renderer=L.svg({pane:'accAssistedZone'});
      this.group=L.layerGroup().addTo(map);
      this.down=e=>this.start(e,null);
      map.getContainer().addEventListener('pointerdown',this.down,true);
      window.addEventListener('pointermove',e=>this.move(e),{passive:false});
      window.addEventListener('pointerup',e=>this.end(e));window.addEventListener('pointercancel',e=>this.end(e));
      window.addEventListener('blur',()=>this.end());
      map.on?.('zoomend',()=>{if(this.shape)this.draw();});
      this.reducedMotion=window.matchMedia?.('(prefers-reduced-motion: reduce)');
      this.reducedMotion?.addEventListener?.('change',()=>{this.stopWave();if(this.shape)this.draw();});
    }
    update(pins,limit,color,nearSite){
      this.nearSite=nearSite;
      const signature=JSON.stringify([pins.map(p=>[p.id,p.lat,p.lon]),limit]);
      if(signature!==this.signature){
        this.end();this.stopWave();this.signature=signature;this.group.clearLayers();this.polygon=null;this.reference=null;this.pulse=null;this.halo=null;this.spark=null;this.invalidLine=null;this.handles=[];this.shape=null;this.invalidPins=pins;
        if(pins.length&&G.diameter(pins).metres<=limit){
          const origin={lat:pins.reduce((s,p)=>s+p.lat,0)/pins.length,lon:pins.reduce((s,p)=>s+p.lon,0)/pins.length};
          this.shape=G.make(pins,limit,G.projection(origin));
        }
      }
      this.color=color;this.draw();
    }
    draw(){
      if(!this.shape){
        if(!this.invalidLine&&this.invalidPins?.length>1){
          this.invalidLine=L.polyline(this.invalidPins.map(p=>[p.lat,p.lon]),{renderer:this.renderer,pane:'accAssistedZone',color:'#c0392b',weight:2,dashArray:'6 6',interactive:false}).addTo(this.group);
        }
        return;
      }
      const ll=G.ring(this.shape).map(p=>[p.lat,p.lon]);
      if(!this.polygon)this.polygon=L.polygon(ll,{renderer:this.renderer,pane:'accAssistedZone',color:this.color,weight:1.4,fillColor:this.color,fillOpacity:.19,interactive:false}).addTo(this.group);
      else this.polygon.setLatLngs(ll).setStyle({color:this.color,fillColor:this.color});
      const contour=this.electricContour(ll);
      if(!this.reference)this.reference=L.polyline(contour,{renderer:this.renderer,pane:'accAssistedZone',color:this.color,weight:1,opacity:.25,interactive:false}).addTo(this.group);
      else this.reference.setLatLngs(contour).setStyle({color:this.color});
      if(!this.pulse){
        this.halo=L.polyline(contour,{renderer:this.renderer,pane:'accAssistedZone',smoothFactor:0,color:this.color,weight:2.8,className:'acc-electric-halo',interactive:false}).addTo(this.group);
        this.pulse=L.polyline(contour,{renderer:this.renderer,pane:'accAssistedZone',smoothFactor:0,color:this.color,weight:1.2,className:'acc-electric-pulse',interactive:false}).addTo(this.group);
        this.spark=L.polyline(contour,{renderer:this.renderer,pane:'accAssistedZone',smoothFactor:0,color:this.color,weight:1.5,className:'acc-electric-spark',interactive:false}).addTo(this.group);
        for(const line of [this.halo,this.pulse,this.spark])line.getElement()?.setAttribute('pathLength','1000');
      }else {for(const line of [this.halo,this.pulse,this.spark])line.setLatLngs(contour).setStyle({color:this.color});}
      this.halo.getElement()?.style.setProperty('--acc-electric-color',this.color);
      if(!this.handles.length)for(const index of [0,4,8,12]){
        const p=this.shape.project.inverse(this.shape.free[index]);
        const marker=L.marker([p.lat,p.lon],{icon:L.divIcon({className:'acc-zone-handle',html:'↔',iconSize:[26,26],iconAnchor:[13,13]}),zIndexOffset:1800,bubblingMouseEvents:false}).addTo(this.group);
        const el=marker.getElement();el.setAttribute('role','button');el.setAttribute('aria-label','Déformer la zone de la boucle — poignée '+(index/4+1));
        el.addEventListener('pointerdown',e=>this.start(e,index));
        el.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();});
        el.addEventListener('keydown',e=>{
          const d={ArrowLeft:{x:-150,y:0},ArrowRight:{x:150,y:0},ArrowUp:{x:0,y:150},ArrowDown:{x:0,y:-150}}[e.key];
          if(d&&this.shape){e.preventDefault();const f=G.move(this.shape,this.shape.free,d,index);this.draw();this.notify(f);}
        });
        marker.zoneIndex=index;this.handles.push(marker);
      }
      this.handles.forEach(m=>{const p=this.shape.project.inverse(this.shape.free[m.zoneIndex]);m.setLatLng([p.lat,p.lon]);m.getElement().style.borderColor=this.color;});
      this.prepareWave(ll);this.startWave();
    }
    electricContour(ll){
      return ll.concat([ll[0]]);
    }
    waveProfile(distance){
      // Signal anguleux de type ECG : petite onde, encoche, pic et rebond.
      const knots=[[-.105,0],[-.085,.16],[-.065,0],[-.030,0],[-.016,-.38],[0,1],[.018,-.65],[.038,0],[.063,.25],[.09,0]];
      for(let i=1;i<knots.length;i++){
        const [x0,y0]=knots[i-1],[x1,y1]=knots[i];
        if(distance===x1)return y1;
        if(distance>=x0&&distance<=x1)return y0+(y1-y0)*(distance-x0)/(x1-x0);
      }
      return 0;
    }
    prepareWave(ll){
      if(!this.map.latLngToLayerPoint)return;
      const base=ll.map(p=>this.map.latLngToLayerPoint(p)),points=[];
      // Échantillonnage visuel uniquement : les pics restent nets à tous les zooms.
      base.forEach((a,i)=>{
        const b=base[(i+1)%base.length],steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/3));
        for(let j=0;j<steps;j++)points.push({x:a.x+(b.x-a.x)*j/steps,y:a.y+(b.y-a.y)*j/steps});
      });
      let perimeter=0,area=0;const positions=[];
      points.forEach((a,i)=>{const b=points[(i+1)%points.length];positions.push(perimeter);perimeter+=Math.hypot(b.x-a.x,b.y-a.y);area+=a.x*b.y-b.x*a.y;});
      if(!perimeter){this.wavePoints=null;return;}
      const orientation=area>=0?1:-1;
      const pins=this.shape.pins.map(p=>this.map.latLngToLayerPoint([p.lat,p.lon]));
      this.wavePoints=points.map((p,i)=>{
        const prev=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length];
        const dx=next.x-prev.x,dy=next.y-prev.y,length=Math.hypot(dx,dy)||1;
        const nearest=pins.reduce((min,pin)=>Math.min(min,Math.hypot(p.x-pin.x,p.y-pin.y)),Infinity);
        return {x:p.x,y:p.y,nx:orientation*dy/length,ny:-orientation*dx/length,s:positions[i]/perimeter,guard:Math.max(0,Math.min(1,(nearest-14)/18))};
      });
      this.waveAmplitude=Math.min(30,Math.max(18,perimeter/55));
    }
    wavePath(phase,amplitude=this.waveAmplitude){
      if(!this.wavePoints?.length)return '';
      return this.wavePoints.map((p,i)=>{
        const distance=((p.s-phase+.5)%1+1)%1-.5;
        const offset=amplitude*this.waveProfile(distance)*p.guard;
        return (i?'L':'M')+(p.x+p.nx*offset).toFixed(2)+' '+(p.y+p.ny*offset).toFixed(2);
      }).join('')+'Z';
    }
    paintWave(phase){
      if(!this.wavePoints?.length)return;
      // La surface et le périmètre restent fixes ; seuls deux arcs courts crépitent.
      this.polygon.getElement()?.setAttribute('d',this.wavePath(0,0));
      const paths=[];
      for(const shift of [0,.47]){
        let drawing=false;
        for(const p of this.wavePoints){
          const distance=((p.s-phase-shift+.5)%1+1)%1-.5;
          if(Math.abs(distance)>.045){drawing=false;continue;}
          const t=(distance+.045)/.09,envelope=Math.sin(Math.PI*t);
          const teeth=2/Math.PI*Math.asin(Math.sin(t*Math.PI*18));
          const offset=7*envelope*teeth*p.guard;
          paths.push((drawing?'L':'M')+(p.x+p.nx*offset).toFixed(2)+' '+(p.y+p.ny*offset).toFixed(2));
          drawing=true;
        }
      }
      const d=paths.join('');
      for(const layer of [this.halo,this.pulse,this.spark])layer?.getElement()?.setAttribute('d',d);
    }
    startWave(){
      if(!this.wavePoints||!window.requestAnimationFrame||this.reducedMotion?.matches){
        if(this.wavePoints&&this.reducedMotion?.matches){const d=this.wavePath(0,0);for(const layer of [this.polygon,this.halo,this.pulse,this.spark])layer?.getElement()?.setAttribute('d',d);}return;
      }
      if(this.waveRequest)return;
      this.waveStarted=window.performance?.now?.()||0;this.lastWaveFrame=-Infinity;
      const tick=time=>{
        if(!this.shape||this.reducedMotion?.matches){this.stopWave();return;}
        this.lastWaveFrame=time;this.paintWave(((time-this.waveStarted)%6200)/6200);
        this.waveRequest=window.requestAnimationFrame(tick);
      };
      this.waveRequest=window.requestAnimationFrame(tick);
    }
    stopWave(){
      if(this.waveRequest)window.cancelAnimationFrame?.(this.waveRequest);
      this.waveRequest=null;this.wavePoints=null;
    }
    start(e,index){
      if(!this.shape||e.button>0||this.drag)return;
      if(index===null&&e.target.closest?.('.leaflet-marker-icon,.leaflet-control,.leaflet-popup'))return;
      const ll=this.map.mouseEventToLatLng(e),point={lat:ll.lat,lon:ll.lng};
      if(index===null&&(!G.contains(this.shape,point)||this.nearSite?.(point)))return;
      e.preventDefault();e.stopPropagation();
      this.drag={pointer:e.pointerId,index,start:this.shape.project.forward(point),free:this.shape.free.map(p=>({...p})),map:this.map.dragging.enabled(),touch:this.map.touchZoom.enabled()};
      this.map.dragging.disable();this.map.touchZoom.disable();
      try{e.target.setPointerCapture(e.pointerId);}catch(error){}
    }
    move(e){
      const d=this.drag;if(!d||d.pointer!==e.pointerId||!this.shape)return;
      e.preventDefault();
      const ll=this.map.mouseEventToLatLng(e),p=this.shape.project.forward({lat:ll.lat,lon:ll.lng});
      const f=G.move(this.shape,d.free,{x:p.x-d.start.x,y:p.y-d.start.y},d.index);
      this.draw();this.notify(f);
    }
    notify(f){this.onStatus(f<.999?'Limite atteinte : les acteurs restent inclus et la zone ne peut pas dépasser '+(this.shape.limit/1000)+' km entre ses extrémités.':'Zone déplacée ; les acteurs restent fixes.');}
    end(e){if(!this.drag||(e&&e.pointerId!==this.drag.pointer))return;if(this.drag.map)this.map.dragging.enable();if(this.drag.touch)this.map.touchZoom.enable();this.drag=null;}
    clear(){this.end();this.stopWave();this.group.clearLayers();this.shape=null;this.polygon=null;this.reference=null;this.pulse=null;this.halo=null;this.spark=null;this.invalidLine=null;this.invalidPins=[];this.handles=[];this.signature='';}
    reset(){this.signature='';}
    bounds(){return this.shape?L.latLngBounds(G.ring(this.shape).map(p=>[p.lat,p.lon])):null;}
  }
  window.AccAssistedZone=AccAssistedZone;
})();
