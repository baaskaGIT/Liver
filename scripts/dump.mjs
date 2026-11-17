import {NodeIO} from '@gltf-transform/core';import fs from 'fs';
const [,,inp,out]=process.argv;const io=new NodeIO();const doc=await io.read(inp);
const prim=doc.getRoot().listMeshes()[0].listPrimitives()[0];
for(const a of ['POSITION','NORMAL','TEXCOORD_0']){const acc=prim.getAttribute(a);console.log(a,acc.getArray().constructor.name,acc.getNormalized(),acc.getCount());fs.writeFileSync(`${out}/${a}.bin`,Buffer.from(new Float32Array(Array.from(acc.getArray(),(v)=>v)).buffer))}
fs.writeFileSync(`${out}/INDICES.bin`,Buffer.from(new Uint32Array(prim.getIndices().getArray()).buffer));
for(const t of doc.getRoot().listTextures()){console.log('tex',t.getName(),t.getMimeType());fs.writeFileSync(`${out}/${t.getName()}.png`,Buffer.from(t.getImage()))}
const m=doc.getRoot().listMaterials()[0];console.log('rough',m.getRoughnessFactor(),'metal',m.getMetallicFactor(),'color',m.getBaseColorFactor());
