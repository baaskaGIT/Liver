// Build a per-vertex "liver tissue" mask (0..1) for a fused AI-generated organ mesh.
import {NodeIO} from '@gltf-transform/core';
import * as THREE from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import sharp from 'sharp';
import fs from 'fs';

export async function loadBase(file){
  const io=new NodeIO();const doc=await io.read(file);
  const prim=doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const pos=Float32Array.from(prim.getAttribute('POSITION').getArray());
  const nor=Float32Array.from(prim.getAttribute('NORMAL').getArray());
  const uv=Float32Array.from(prim.getAttribute('TEXCOORD_0').getArray());
  const idx=Uint32Array.from(prim.getIndices().getArray());
  const mat=prim.getMaterial();const tex=mat.getBaseColorTexture();
  const img=await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({resolveWithObject:true});
  return {io,doc,prim,pos,nor,uv,idx,img};
}

export function weld(pos){
  const n=pos.length/3,key=new Map(),wid=new Int32Array(n);let u=0;
  for(let i=0;i<n;i++){const k=Math.round(pos[3*i]*1e5)+','+Math.round(pos[3*i+1]*1e5)+','+Math.round(pos[3*i+2]*1e5);let w=key.get(k);if(w===undefined){w=u++;key.set(k,w)}wid[i]=w}
  return {wid,count:u};
}

export function adjacency(idx,wid,count){
  const nb=Array.from({length:count},()=>new Set());
  for(let t=0;t<idx.length;t+=3){const a=wid[idx[t]],b=wid[idx[t+1]],c=wid[idx[t+2]];nb[a].add(b).add(c);nb[b].add(a).add(c);nb[c].add(a).add(b)}
  return nb.map(s=>Int32Array.from(s));
}

export function smooth(vals,nb,iters){
  let a=Float32Array.from(vals);
  for(let k=0;k<iters;k++){const b=new Float32Array(a.length);for(let i=0;i<a.length;i++){let s=a[i];const l=nb[i];for(let j=0;j<l.length;j++)s+=a[l[j]];b[i]=s/(l.length+1)}a=b}
  return a;
}

function rgb2hsv(r,g,b){const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;let h=0;if(d>0){if(mx===r)h=((g-b)/d)%6;else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;h*=60;if(h<0)h+=360}return [h,mx?d/mx:0,mx]}

export function computeMask(base,{SMAX=0.7,TUBE_RINGS=4,TUBE_L=0.85}={}){
  const {pos,nor,uv,idx,img}=base;const n=pos.length/3;
  const {wid,count}=weld(pos);const nb=adjacency(idx,wid,count);
  // welded normals
  const wn=new Float32Array(count*3);for(let i=0;i<n;i++)for(let j=0;j<3;j++)wn[3*wid[i]+j]+=nor[3*i+j];
  const wp=new Float32Array(count*3);for(let i=0;i<n;i++)for(let j=0;j<3;j++)wp[3*wid[i]+j]=pos[3*i+j];
  for(let w=0;w<count;w++){const l=Math.hypot(wn[3*w],wn[3*w+1],wn[3*w+2])||1;wn[3*w]/=l;wn[3*w+1]/=l;wn[3*w+2]/=l}
  // tube score: on thin vessels the normals point all around within a few rings, on the liver surface they agree
  let an=Float32Array.from(wn);
  for(let k=0;k<TUBE_RINGS;k++){const b=new Float32Array(an.length);for(let i=0;i<count;i++){const l=nb[i];let x=an[3*i],y=an[3*i+1],z=an[3*i+2];for(let j=0;j<l.length;j++){x+=an[3*l[j]];y+=an[3*l[j]+1];z+=an[3*l[j]+2]}const c=l.length+1;b[3*i]=x/c;b[3*i+1]=y/c;b[3*i+2]=z/c}an=b}
  const tube=new Float32Array(count);for(let w=0;w<count;w++){const L=Math.hypot(an[3*w],an[3*w+1],an[3*w+2]);tube[w]=Math.min(1,Math.max(0,(TUBE_L-L)/0.2))}
  // colour per welded vertex: liverish (red/orange, moderate saturation), saturated red (artery) or other (blue, green, beige)
  const liv=new Float32Array(count),sat=new Float32Array(count),cn=new Float32Array(count);const {data,info}=img;
  for(let i=0;i<n;i++){let x=Math.min(info.width-1,Math.max(0,Math.floor(uv[2*i]*info.width)));let y=Math.min(info.height-1,Math.max(0,Math.floor(uv[2*i+1]*info.height)));const o=(y*info.width+x)*3;
    const [h,s,v]=rgb2hsv(data[o]/255,data[o+1]/255,data[o+2]/255);
    const red=(h<40||h>320)&&s>0.25;
    liv[wid[i]]+=red?1:0;sat[wid[i]]+=(red&&s>SMAX)?1:0;cn[wid[i]]+=1}
  let m=new Float32Array(count);for(let w=0;w<count;w++){const l=liv[w]/cn[w],st=sat[w]/cn[w];m[w]=l*(1-st*tube[w])}
  const disp=tube;
  m=smooth(m,nb,4);for(let w=0;w<count;w++)m[w]=Math.min(1,Math.max(0,(m[w]-0.35)/0.3));
  m=smooth(m,nb,3);
  const thick=disp;
  return {wid,count,nb,wp,wn,thick,mask:m};
}
