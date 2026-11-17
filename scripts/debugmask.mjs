import {loadBase,computeMask} from './mask.mjs';
const base=await loadBase(process.argv[2]);const t=Date.now();const r=computeMask(base,JSON.parse(process.argv[4]||"{}"));console.log('ms',Date.now()-t);
const n=base.pos.length/3;const c=new Float32Array(n*3);for(let i=0;i<n;i++){const m=r.mask[r.wid[i]];c[3*i]=m;c[3*i+1]=0.15;c[3*i+2]=1-m}
const acc=base.doc.createAccessor().setType('VEC3').setArray(c);base.prim.setAttribute('COLOR_0',acc);
const mat=base.prim.getMaterial();mat.setBaseColorTexture(null);
await base.io.write(process.argv[3],base.doc);
const th=[...r.thick].sort((a,b)=>a-b);console.log('thick pct',[0.1,0.3,0.5,0.7,0.9].map(p=>th[Math.floor(p*th.length)].toFixed(3)));
