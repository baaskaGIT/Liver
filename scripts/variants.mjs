// Make fatty-liver and cirrhosis variants of the AI-generated healthy liver.
// Same topology as the input, so the site can swap or morph between them.
import {loadBase,computeMask,smooth} from './mask.mjs';
import sharp from 'sharp';

const [,,inp,outDir]=process.argv;

// ---------- noise ----------
function hash3(x,y,z){let h=(x*374761393+y*668265263+z*1274126177)|0;h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return (h>>>0)/4294967295}
function worley(px,py,pz,cell){const x=px/cell,y=py/cell,z=pz/cell;const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);let f1=1e9,f2=1e9;
  for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(let c=-1;c<=1;c++){const cx=ix+a,cy=iy+b,cz=iz+c;const fx=cx+hash3(cx,cy,cz),fy=cy+hash3(cx+31,cy+17,cz+5),fz=cz+hash3(cx+7,cy+59,cz+23);const d=Math.hypot(fx-x,fy-y,fz-z);if(d<f1){f2=f1;f1=d}else if(d<f2)f2=d}
  return [f1,f2]}
const sstep=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t)};

// ---------- helpers ----------
function faceNormals(wp,idx,wid,count){const wn=new Float32Array(count*3);for(let t=0;t<idx.length;t+=3){const a=wid[idx[t]],b=wid[idx[t+1]],c=wid[idx[t+2]];const ax=wp[3*a],ay=wp[3*a+1],az=wp[3*a+2];const ux=wp[3*b]-ax,uy=wp[3*b+1]-ay,uz=wp[3*b+2]-az,vx=wp[3*c]-ax,vy=wp[3*c+1]-ay,vz=wp[3*c+2]-az;const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;for(const w of [a,b,c]){wn[3*w]+=nx;wn[3*w+1]+=ny;wn[3*w+2]+=nz}}
  for(let w=0;w<count;w++){const l=Math.hypot(wn[3*w],wn[3*w+1],wn[3*w+2])||1;wn[3*w]/=l;wn[3*w+1]/=l;wn[3*w+2]/=l}return wn}
function laplace(wp,nb,iters){let a=Float32Array.from(wp);for(let k=0;k<iters;k++){const b=new Float32Array(a.length);for(let i=0;i<nb.length;i++){const l=nb[i];let x=0,y=0,z=0;for(let j=0;j<l.length;j++){x+=a[3*l[j]];y+=a[3*l[j]+1];z+=a[3*l[j]+2]}const c=l.length||1;b[3*i]=0.5*a[3*i]+0.5*x/c;b[3*i+1]=0.5*a[3*i+1]+0.5*y/c;b[3*i+2]=0.5*a[3*i+2]+0.5*z/c}a=b}return a}

// rasterise per-vertex attributes into UV space (mask + original 3D position)
function rasterize(base,wid,mask,W,H){
  const {uv,idx,pos}=base;const M=new Float32Array(W*H),P=new Float32Array(W*H*3),cov=new Uint8Array(W*H);
  for(let t=0;t<idx.length;t+=3){const i0=idx[t],i1=idx[t+1],i2=idx[t+2];
    const x0=uv[2*i0]*W,y0=uv[2*i0+1]*H,x1=uv[2*i1]*W,y1=uv[2*i1+1]*H,x2=uv[2*i2]*W,y2=uv[2*i2+1]*H;
    const minx=Math.max(0,Math.floor(Math.min(x0,x1,x2))),maxx=Math.min(W-1,Math.ceil(Math.max(x0,x1,x2))),miny=Math.max(0,Math.floor(Math.min(y0,y1,y2))),maxy=Math.min(H-1,Math.ceil(Math.max(y0,y1,y2)));
    const den=(y1-y2)*(x0-x2)+(x2-x1)*(y0-y2);if(Math.abs(den)<1e-12)continue;
    for(let y=miny;y<=maxy;y++)for(let x=minx;x<=maxx;x++){const px=x+0.5,py=y+0.5;const a=((y1-y2)*(px-x2)+(x2-x1)*(py-y2))/den,b=((y2-y0)*(px-x2)+(x0-x2)*(py-y2))/den,c=1-a-b;
      if(a<-0.02||b<-0.02||c<-0.02)continue;const o=y*W+x;cov[o]=1;
      M[o]=a*mask[wid[i0]]+b*mask[wid[i1]]+c*mask[wid[i2]];
      for(let j=0;j<3;j++)P[3*o+j]=a*pos[3*i0+j]+b*pos[3*i1+j]+c*pos[3*i2+j]}}
  // dilate into gutters so bilinear sampling at seams stays consistent
  for(let pass=0;pass<4;pass++){const nc=Uint8Array.from(cov);for(let y=0;y<H;y++)for(let x=0;x<W;x++){const o=y*W+x;if(cov[o])continue;for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=W||Y>=H)continue;const q=Y*W+X;if(cov[q]){M[o]=M[q];P[3*o]=P[3*q];P[3*o+1]=P[3*q+1];P[3*o+2]=P[3*q+2];nc[o]=1;break}}}cov.set(nc)}
  return {M,P,cov};
}

async function build(kind){
  const base=await loadBase(inp);const n=base.pos.length/3;
  const r=computeMask(base,{TUBE_RINGS:15,TUBE_L:0.92});const {wid,count,nb,wp,wn}=r;const m=r.mask;
  // geometry uses a wider, softer mask so painted surface veins move together with the tissue around them
  const mg=smooth(m.map(v=>v>0.5?1:0),nb,30);
  // ---------- geometry ----------
  let np=Float32Array.from(wp);
  if(kind==='fatty'){
    const sm=laplace(wp,nb,6);
    for(let w=0;w<count;w++){const k=mg[w];for(let j=0;j<3;j++)np[3*w+j]=wp[3*w+j]+k*0.2*(sm[3*w+j]-wp[3*w+j])+k*0.018*wn[3*w+j]}
  } else {
    for(let w=0;w<count;w++){const k=mg[w];const [f1,f2]=worley(wp[3*w],wp[3*w+1],wp[3*w+2],0.11);const nod=1-sstep(0.0,0.95,f1);const groove=1-sstep(0.0,0.1,f2-f1);
      const d=k*(-0.012+0.017*nod-0.008*groove);for(let j=0;j<3;j++)np[3*w+j]=wp[3*w+j]+d*wn[3*w+j]}
  }
  const nn=faceNormals(np,base.idx,wid,count);
  const P=new Float32Array(n*3),N=new Float32Array(n*3);for(let i=0;i<n;i++)for(let j=0;j<3;j++){P[3*i+j]=np[3*wid[i]+j];N[3*i+j]=nn[3*wid[i]+j]}
  base.prim.getAttribute('POSITION').setArray(P);base.prim.getAttribute('NORMAL').setArray(N);
  // ---------- texture ----------
  const {data,info}=base.img;const W=info.width,H=info.height;const R=rasterize(base,wid,m,W,H);
  const out=Buffer.alloc(W*H*3);
  for(let o=0;o<W*H;o++){const r0=data[3*o]/255,g0=data[3*o+1]/255,b0=data[3*o+2]/255;const L=0.3*r0+0.59*g0+0.11*b0;const k=R.M[o];let r1=r0,g1=g0,b1=b0;
    if(k>0.001){const mx=Math.max(r0,g0,b0),mn=Math.min(r0,g0,b0);const sat=mx?(mx-mn)/mx:0;const blueish=(b0>r0)?1:0;const kk=k*(1-blueish*0.85);
      const det=Math.min(1.5,Math.max(0.5,Math.pow(L/0.42,1.3)));
      const x=R.P[3*o],y=R.P[3*o+1],z=R.P[3*o+2];
      if(kind==='fatty'){
        const [f1]=worley(x,y,z,0.018);const drop=1-sstep(0.15,0.45,f1);
        const tr=0.8*det,tg=0.56*det,tb=0.26*det;
        r1=tr+drop*0.04;g1=tg+drop*0.05;b1=tb+drop*0.03;
      } else {
        const [f1,f2]=worley(x,y,z,0.11);const sept=0.45*(1-sstep(0.0,0.06,f2-f1));const centre=1-sstep(0.0,0.8,f1);
        r1=(0.66+0.08*centre)*det;g1=(0.36+0.07*centre)*det;b1=(0.2+0.03*centre)*det;
        r1=r1*(1-sept)+0.82*sept;g1=g1*(1-sept)+0.72*sept;b1=b1*(1-sept)+0.6*sept;
      }
      r1=r0+(r1-r0)*kk;g1=g0+(g1-g0)*kk;b1=b0+(b1-b0)*kk}
    out[3*o]=Math.round(Math.min(1,Math.max(0,r1))*255);out[3*o+1]=Math.round(Math.min(1,Math.max(0,g1))*255);out[3*o+2]=Math.round(Math.min(1,Math.max(0,b1))*255)}
  const png=await sharp(out,{raw:{width:W,height:H,channels:3}}).png().toBuffer();
  const mat=base.prim.getMaterial();mat.getBaseColorTexture().setImage(new Uint8Array(png));
  mat.setMetallicFactor(0);if(kind==='fatty')mat.setRoughnessFactor(0.7);
  await base.io.write(`${outDir}/liver-${kind}.raw.glb`,base.doc);console.log('wrote',kind);
}
for(const k of ['fatty','cirrhosis'])await build(k);
