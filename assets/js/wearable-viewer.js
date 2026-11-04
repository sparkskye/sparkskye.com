import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE='/assets/models/minecraft/';
const loader=new GLTFLoader();
const modelCache=new Map();
async function model(kind) {
  if(!modelCache.has(kind))modelCache.set(kind,loader.loadAsync(BASE+kind+'.gltf').catch(e=>{modelCache.delete(kind);throw e}));
  return (await modelCache.get(kind)).scene.clone(true);
}
async function loadImage(url) {
  const image=new Image();image.crossOrigin='anonymous';
  await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url});
  return image;
}
function slimFromTexture(image) {
  // Slim skin layouts leave a transparent one-pixel column at the edge of
  // both arm faces. Inspect the actual alpha channel, not the RGB color.
  if(image.width!==image.height || image.width<64)return false;
  const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
  const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
  try {
    const s=image.width/64;
    const alpha=(x,y)=>ctx.getImageData(Math.floor(x*s),Math.floor(y*s),1,1).data[3];
    return [[54,20],[54,24],[54,28],[54,31],[46,52],[46,56],[46,60],[46,63]].every(([x,y])=>alpha(x,y)<8);
  }catch{return false}
}
function resize(host,camera,renderer) {
  const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);
  camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);
}
function button(label,title,onClick) {
  const el=document.createElement('button');el.type='button';el.className='wearable-control';el.textContent=label;el.title=title;el.addEventListener('click',onClick);return el;
}
export async function createWearableViewer(host,opts={}) {
  const isCape=opts.kind==='cape';
  const image=await loadImage(opts.textureUrl);
  let metadata={};
  if(opts.metadataUrl){try{const res=await fetch(opts.metadataUrl);if(res.ok)metadata=await res.json()}catch(e){console.warn('Wearable metadata unavailable',e)}}
  const slim=!isCape && (metadata.model==='slim'||metadata.armType==='slim'||(metadata.model!=='wide'&&metadata.armType!=='wide'&&slimFromTexture(image)));
  const modelKind=isCape?'cape':slim?'slim':'wide';
  const root=await model(modelKind);
  const scene=new THREE.Scene();scene.add(root);
  const bounds=new THREE.Box3().setFromObject(root);
  const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
  const radius=Math.max(size.x,size.y,size.z,1);
  const camera=new THREE.PerspectiveCamera(38,1,.01,200);
  camera.position.copy(center).add(new THREE.Vector3(radius*.95,radius*.35,radius*1.8));
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:!opts.card,preserveDrawingBuffer:!!opts.card});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
  renderer.domElement.className='wearable-canvas';host.appendChild(renderer.domElement);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.target.copy(center);controls.enableDamping=true;controls.dampingFactor=.08;controls.update();controls.saveState();
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  if(!ctx)throw Error('Canvas unavailable');
  // Each frame is a complete cape atlas, preserving its normalized UV layout
  // regardless of whether the PNG is 64, 128, or more pixels wide.
  const frameHeight=isCape?Math.round(image.width/2):image.height;
  const availableFrames=Math.max(1,Math.floor(image.height/frameHeight));
  const frames=isCape?Math.max(1,Math.min(availableFrames,Math.floor(Number(metadata.frames)||availableFrames))):1;
  const fps=Math.max(.1,Math.min(60,Number(metadata.fps)||10));
  const hold=Math.max(0,Math.min(600,Math.floor(Number(metadata.firstFrameHold)||0)));
  canvas.width=image.width;canvas.height=frameHeight;
  const texture=new THREE.CanvasTexture(canvas);
  texture.flipY=false;texture.colorSpace=THREE.SRGBColorSpace;
  texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestFilter;
  const paint=(i)=>{ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,i*frameHeight,image.width,frameHeight,0,0,canvas.width,canvas.height);texture.needsUpdate=true};
  paint(0);
  const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.04,side:THREE.DoubleSide});
  const meshes=[];
  root.traverse(obj=>{if(obj.isMesh){obj.material=material;meshes.push(obj)}});
  // Supplied Blockbench files contain only the outer clothing/hat meshes.
  // Add the missing inner skin cubes inside those existing rig pivots.
  if(!isCape){
    const atlas={
      'Hat Layer':[0,0,8,8,8],
      'Body Layer':[16,16,8,12,4],
      'Right Arm Layer':[40,16,slim?3:4,12,4],
      'Left Arm Layer':[32,48,slim?3:4,12,4],
      'Right Leg Layer':[0,16,4,12,4],
      'Left Leg Layer':[16,48,4,12,4]
    };
    function innerGeometry(source,info){
      source.computeBoundingBox();
      const box=source.boundingBox;
      const dimensions=new THREE.Vector3();box.getSize(dimensions);
      const center=new THREE.Vector3();box.getCenter(center);
      const [u,v,w,h,d]=info;
      const geometry=new THREE.BoxGeometry(dimensions.x*(w/(w+.5)),dimensions.y*(h/(h+.5)),dimensions.z*(d/(d+.5)));
      const uv=geometry.attributes.uv;
      const faces=[
        [u+d+w,v+d,d,h],[u,v+d,d,h],
        [u+d,v,w,d],[u+d+w,v,w,d],
        [u+d,v+d,w,h],[u+2*d+w,v+d,w,h]
      ];
      for(let face=0;face<6;face++){
        const [x,y,fw,fh]=faces[face];
        const corners=[[x+fw,y],[x,y],[x+fw,y+fh],[x,y+fh]];
        for(let j=0;j<4;j++)uv.setXY(face*4+j,corners[j][0]/64,1-corners[j][1]/64);
      }
      uv.needsUpdate=true;
      geometry.translate(center.x,center.y,center.z);
      return geometry;
    }
    const outerMeshes=[...meshes];
    for(const outer of outerMeshes){
      const info=atlas[outer.name];if(!info)continue;
      const inner=new THREE.Mesh(innerGeometry(outer.geometry,info),material);
      inner.name=outer.name.replace(' Layer',' Base');
      inner.renderOrder=-1;
      outer.parent.add(inner);meshes.push(inner);
    }
  }
  // Keep the original Blockbench hierarchy and animation targets intact.
  const mixer=new THREE.AnimationMixer(root);
  const clips=(await modelCache.get(modelKind)).animations||[];
  let action=null,manualMode='still';
  const toolbar=document.createElement('div');toolbar.className='wearable-controls';
  const pivot=(name)=>{let found=null;root.traverse(o=>{if(o.name===name&&o.children.length&&(!found||o.children.length>found.children.length))found=o});return found};
  const joints={head:pivot('Head'),rightArm:pivot('Right Arm'),leftArm:pivot('Left Arm'),rightLeg:pivot('Right Leg'),leftLeg:pivot('Left Leg')};
  const movable=Object.values(joints).filter(Boolean);
  movable.forEach(j=>{j.userData.originalRotation=j.rotation.clone()});
  const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();
  let grabbed=null,lastX=0,lastY=0;
  renderer.domElement.addEventListener('pointerdown',e=>{
    if(manualMode!=='pose')return;
    const r=renderer.domElement.getBoundingClientRect();
    pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);
    ray.setFromCamera(pointer,camera);
    const hit=ray.intersectObjects(meshes,true)[0];if(!hit)return;
    let obj=hit.object;while(obj&&!movable.includes(obj))obj=obj.parent;
    if(!obj)return;
    grabbed=obj;lastX=e.clientX;lastY=e.clientY;controls.enabled=false;
    renderer.domElement.setPointerCapture(e.pointerId);
  });
  renderer.domElement.addEventListener('pointermove',e=>{
    if(!grabbed)return;
    grabbed.rotation.x=Math.max(-1.6,Math.min(1.6,grabbed.rotation.x+(e.clientY-lastY)*.012));
    grabbed.rotation.z=Math.max(-1.6,Math.min(1.6,grabbed.rotation.z+(e.clientX-lastX)*.012));
    lastX=e.clientX;lastY=e.clientY;
  });
  const release=()=>{grabbed=null;controls.enabled=true};
  renderer.domElement.addEventListener('pointerup',release);
  renderer.domElement.addEventListener('pointercancel',release);
  const ro=new ResizeObserver(()=>resize(host,camera,renderer));ro.observe(host);resize(host,camera,renderer);
  const clock=new THREE.Clock();let elapsed=0,previous=-1,raf=0,disposed=false;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const render=()=>{
    if(disposed)return;
    const delta=Math.min(.05,clock.getDelta());elapsed+=delta;
    if(!reduced&&frames>1){
      const slot=Math.floor(elapsed*fps)%(frames+hold);
      const index=slot<hold?0:slot-hold;
      if(index!==previous){paint(index);previous=index}
    }
    if(action)mixer.update(delta);
    else if(!reduced&&manualMode!=='pose'){
      const speed=manualMode==='run'?9:manualMode==='walk'?5:1.8;
      const amount=manualMode==='run'?.7:manualMode==='walk'?.4:manualMode==='idle'?.035:0;
      if(joints.rightArm)joints.rightArm.rotation.x=Math.sin(elapsed*speed)*amount;
      if(joints.leftArm)joints.leftArm.rotation.x=-Math.sin(elapsed*speed)*amount;
      if(joints.rightLeg)joints.rightLeg.rotation.x=-Math.sin(elapsed*speed)*amount;
      if(joints.leftLeg)joints.leftLeg.rotation.x=Math.sin(elapsed*speed)*amount;
    }
    controls.update();renderer.render(scene,camera);raf=requestAnimationFrame(render);
  };
  if(!opts.card)render();
  else {controls.update();renderer.render(scene,camera)}
  return {snapshot(){controls.update();renderer.render(scene,camera);return renderer.domElement.toDataURL('image/png')},destroy(){disposed=true;cancelAnimationFrame(raf);ro.disconnect();controls.dispose();mixer.stopAllAction();material.dispose();texture.dispose();renderer.dispose();renderer.domElement.remove();toolbar.remove()}};
}
