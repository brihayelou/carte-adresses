/* Géométrie sphérique de la démonstration. La projection gnomonique transforme
   les segments du plan en arcs de grands cercles. Une enveloppe convexe dont
   toutes les paires de sommets sont à moins de D (< 90°) garde cette propriété
   sur toute sa surface, pas seulement sur les sites sélectionnés. */
(function(root, factory) {
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.DemoZoneGeometry=api;
})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  const R=6371000, rad=Math.PI/180;
  function distance(a,b){
    const h=Math.sin((b.lat-a.lat)*rad/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin((b.lon-a.lon)*rad/2)**2;
    return 2*R*Math.atan2(Math.sqrt(Math.min(1,h)),Math.sqrt(Math.max(0,1-h)));
  }
  function destination(c,bearing,metres){
    const p=c.lat*rad,l=c.lon*rad,b=bearing*rad,d=metres/R;
    const p2=Math.asin(Math.sin(p)*Math.cos(d)+Math.cos(p)*Math.sin(d)*Math.cos(b));
    return{lat:p2/rad,lon:(l+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(p),Math.cos(d)-Math.sin(p)*Math.sin(p2)))/rad};
  }
  function projection(origin){
    const p0=origin.lat*rad,l0=origin.lon*rad;
    return {
      forward(p){
        const lat=p.lat*rad,dl=p.lon*rad-l0;
        const c=Math.sin(p0)*Math.sin(lat)+Math.cos(p0)*Math.cos(lat)*Math.cos(dl);
        if(c<=0)throw Error('Hors du domaine de projection');
        return{x:R*Math.cos(lat)*Math.sin(dl)/c,y:R*(Math.cos(p0)*Math.sin(lat)-Math.sin(p0)*Math.cos(lat)*Math.cos(dl))/c};
      },
      inverse(p){
        const x=p.x/R,y=p.y/R,r=Math.hypot(x,y);if(r<1e-15)return{...origin};
        const c=Math.atan(r);
        return{lat:Math.asin(Math.cos(c)*Math.sin(p0)+y*Math.sin(c)*Math.cos(p0)/r)/rad,
          lon:(l0+Math.atan2(x*Math.sin(c),r*Math.cos(p0)*Math.cos(c)-y*Math.sin(p0)*Math.sin(c)))/rad};
      }
    };
  }
  function hull(points){
    const sorted=points.map(p=>({...p})).sort((a,b)=>a.x-b.x||a.y-b.y).filter((p,i,a)=>!i||Math.hypot(p.x-a[i-1].x,p.y-a[i-1].y)>.00001);
    if(sorted.length<=2)return sorted;
    const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    const lower=[],upper=[];
    for(const p of sorted){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
    for(const p of sorted.slice().reverse()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
    lower.pop();upper.pop();return lower.concat(upper);
  }
  function diameter(points){
    let metres=0,pair=null;
    for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
      const d=distance(points[i],points[j]);if(d>metres){metres=d;pair=[points[i],points[j]];}
    }
    return{metres,pair};
  }
  function make(pins,limit,project){
    const pinned=pins.map(p=>project.forward(p));
    const center={x:pinned.reduce((s,p)=>s+p.x,0)/pinned.length,y:pinned.reduce((s,p)=>s+p.y,0)/pinned.length};
    const bound=Math.max(diameter(pins).metres,limit-1);
    const build=radius=>Array.from({length:16},(_,i)=>({x:center.x+radius*Math.cos(i*Math.PI/8),y:center.y+radius*Math.sin(i*Math.PI/8)}));
    const valid=free=>diameter(hull([...pinned,...free]).map(p=>project.inverse(p))).metres<=bound+1e-7;
    let low=0,high=limit*.47;
    for(let i=0;i<45;i++){const mid=(low+high)/2;if(valid(build(mid)))low=mid;else high=mid;}
    return{pins:pins.map(p=>({...p})),free:build(low),limit,project};
  }
  function vertices(shape,free=shape.free){return hull([...shape.pins.map(p=>shape.project.forward(p)),...free]);}
  function feasible(shape,free){return diameter(vertices(shape,free).map(p=>shape.project.inverse(p))).metres<=Math.max(diameter(shape.pins).metres,shape.limit-0.05)+1e-6;}
  function move(shape,fromFree,delta,index=null){
    const proposed=t=>fromFree.map((p,i)=>({x:p.x+(index===null||index===i?delta.x*t:0),y:p.y+(index===null||index===i?delta.y*t:0)}));
    let fraction=1;
    if(!feasible(shape,proposed(1))){
      let low=0,high=1;
      for(let i=0;i<38;i++){const mid=(low+high)/2;if(feasible(shape,proposed(mid)))low=mid;else high=mid;}
      fraction=low;
    }
    shape.free=proposed(fraction);return fraction;
  }
  function ring(shape){
    const v=vertices(shape),out=[];
    for(let i=0;i<v.length;i++){
      const a=v[i],b=v[(i+1)%v.length],steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/100));
      for(let j=0;j<steps;j++)out.push(shape.project.inverse({x:a.x+(b.x-a.x)*j/steps,y:a.y+(b.y-a.y)*j/steps}));
    }
    return out;
  }
  function contains(shape,p){
    const q=shape.project.forward(p),v=vertices(shape);
    return v.every((a,i)=>{const b=v[(i+1)%v.length];return ((b.x-a.x)*(q.y-a.y)-(b.y-a.y)*(q.x-a.x))/Math.max(.001,Math.hypot(b.x-a.x,b.y-a.y))>=-.001;});
  }
  return{distance,destination,projection,hull,diameter,make,vertices,move,ring,contains};
});
