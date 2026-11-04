import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

// Shared lightweight Minecraft wearable viewer. Gallery cards remain static.
export async function createWearableViewer(host, options) {
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(38,1,.01,100);
  camera.position.set(2.4,1.65,3.9);
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  renderer.domElement.style.cssText='width:100%;height:100%;display:block;touch-action:none';
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.target.set(0,0.9,0);
  controls.enableDamping=true; controls.update();controls.saveState();
  const root=new THREE.Group();scene.add(root);
  const isCape=options.kind==='cape';
  let disposed=false,raf=0,mixer=null,animationNames=[];
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:false});
  const image=new Image();image.crossOrigin='anonymous';
  const source=options.textureUrl;
  const loadImage=()=>new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=source});
  await loadImage();
  if(!ctx) throw new Error('Canvas unavailable');
  const frameHeight=isCape?Math.max(1,Math.round(image.width/2)):image.height;
  const totalAvailable=Math.max(1,Math.floor(image.height/frameHeight));
  let meta={frames:1,fps:10,firstFrameHold:0};
  if(isCape && options.metadataUrl){
    try{
      const res=await fetch(options.metadataUrl);
      if(res.ok){const json=await res.json();meta={
        frames:Math.max(1,Math.min(totalAvailable,Math.floor(Number(json.frames)||1))),
        fps:Math.max(.1,Math.min(60,Number(json.fps)||10)),
        firstFrameHold:Math.max(0,Math.min(600,Math.floor(Number(json.firstFrameHold)||0)))
      };}
    }catch(err){console.warn('Cape metadata unavailable',err)}
  }
  canvas.width=image.width;canvas.height=frameHeight;
  const texture=new THREE.CanvasTexture(canvas);
  texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestFilter;
  texture.colorSpace=THREE.SRGBColorSpace;
  const drawFrame=(frame)=>{
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,0,frame*frameHeight,image.width,frameHeight,0,0,canvas.width,canvas.height);
    texture.needsUpdate=true;
  };
  drawFrame(0);
  const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.01,side:THREE.DoubleSide});
  // UVs use top-left atlas coordinates; Three.js UVs use a bottom-left origin.
  function makeBox(w,h,d,u,v,outer=false){
    const geometry=new THREE.BoxGeometry(w/16,h/16,d/16);
    const uv=geometry.attributes.uv;
    const W=canvas.width,H=canvas.height;
    const faces=[[u+d+w,v+d,d,h],[u,v+d,d,h],[u+d,v,w,d],[u+d+w,v,w,d],[u+d,v+d,w,h],[u+2*d+w,v+d,w,h]];
    for(let f=0;f<6;f++){
      const [x,y,fw,fh]=faces[f];
      const coords=[[x+fw,y],[x,y],[x+fw,y+fh],[x,y+fh]];
      for(let j=0;j<4;j++)uv.setXY(f*4+j,coords[j][0]/W,1-coords[j][1]/H);
    }
    uv.needsUpdate=true;
    return new THREE.Mesh(geometry,material);
  }
  const joints=[];
  const addPart=(name,w,h,d,u,v,x,y,z,outerAtlas=null)=>{
    const pivot=new THREE.Group();pivot.name=name;pivot.position.set(x/16,y/16,z/16);root.add(pivot);
    const mesh=makeBox(w,h,d,u,v);mesh.position.y=-h/32;pivot.add(mesh);
    if(outerAtlas){
      const layer=makeBox(w+.5,h+.5,d+.5,outerAtlas[0],outerAtlas[1],true);
      layer.position.y=-h/32;pivot.add(layer);
    }
    joints.push({name,pivot});
    return pivot;
  };
  // Standard 64x64 skin layout. Slim arms use the three-pixel UV region.
  const slim=false;
  const head=addPart('Head',8,8,8,0,0,0,32,0,[32,0]);
  addPart('Body',8,12,4,16,16,0,24,0,[16,32]);
  const rightArm=addPart('Right Arm',slim?3:4,12,4,40,16,-6,24,0,[40,32]);
  const leftArm=addPart('Left Arm',slim?3:4,12,4,32,48,6,24,0,[48,48]);
  const rightLeg=addPart('Right Leg',4,12,4,0,16,-2,12,0,[0,32]);
  const leftLeg=addPart('Left Leg',4,12,4,16,48,2,12,0,[0,48]);
  if(isCape){
    // A cape is attached behind the torso. Default character texture is neutral.
    const cape=makeBox(10,16,1,0,0);
    cape.position.set(0,17/16,-3.7/16);
    root.add(cape);
    // The cape texture must not be applied to the player's skin.
    for(const part of joints)part.pivot.visible=false;
  }
  // Animation clips from future rigged GLTF assets can be connected here.
  const toolbar=document.createElement('div');
  toolbar.className='wearable-controls';
  const reset=document.createElement('button');reset.type='button';reset.textContent='100%';reset.title='Reset angle and zoom';
  reset.onclick=()=>{controls.reset();joints.forEach(j=>j.pivot.rotation.set(0,0,0));};
  toolbar.appendChild(reset);
  if(!isCape){
    const select=document.createElement('select');select.setAttribute('aria-label','Character animation');
    for(const [label,value] of [['Still','still'],['Idle','idle'],['Walk','walk'],['Run','run'],['Pose','pose']]){
      const opt=document.createElement('option');opt.value=value;opt.textContent=label;select.appendChild(opt);
    }
    toolbar.appendChild(select);
    let mode='still';select.onchange=()=>{mode=select.value;};
    let grabbed=null,prev=null;
    const ray=new THREE.Raycaster(),point=new THREE.Vector2();
    renderer.domElement.addEventListener('pointerdown',e=>{
      if(mode!=='pose')return;
      const rect=renderer.domElement.getBoundingClientRect();
      point.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
      ray.setFromCamera(point,camera);
      const hit=ray.intersectObjects(root.children,true)[0];
      if(!hit)return;
      grabbed=joints.find(j=>{let obj=hit.object;while(obj){if(obj===j.pivot)return true;obj=obj.parent}return false})?.pivot||null;
      if(grabbed){controls.enabled=false;prev=[e.clientX,e.clientY];renderer.domElement.setPointerCapture(e.pointerId)}
    });
    renderer.domElement.addEventListener('pointermove',e=>{
      if(!grabbed||!prev)return;
      grabbed.rotation.x=Math.max(-1.6,Math.min(1.6,grabbed.rotation.x+(e.clientY-prev[1])*.012));
      grabbed.rotation.z=Math.max(-1.6,Math.min(1.6,grabbed.rotation.z+(e.clientX-prev[0])*.012));
      prev=[e.clientX,e.clientY];
    });
    const release=()=>{grabbed=null;prev=null;controls.enabled=true};
    renderer.domElement.addEventListener('pointerup',release);
    renderer.domElement.addEventListener('pointercancel',release);
    const clock=new THREE.Clock();
    const animate=(t)=>{
      if(disposed)return;
      const elapsed=clock.getElapsedTime();
      if(!reduced && mode!=='pose'){
        const speed=mode==='run'?9:mode==='walk'?5:1.7;
        const amp=mode==='run'?.75:mode==='walk'?.45:mode==='idle'?.035:0;
        rightArm.rotation.x=Math.sin(elapsed*speed)*amp;
        leftArm.rotation.x=-rightArm.rotation.x;
        rightLeg.rotation.x=-rightArm.rotation.x;
        leftLeg.rotation.x=rightArm.rotation.x;
        head.rotation.y=mode==='idle'?Math.sin(elapsed*.8)*.04:0;
      }
    };
    root.userData.animate=animate;
  }
  host.appendChild(toolbar);
  toolbar.style.cssText='position:absolute;bottom:12px;left:50%;transform:translateX(-50%);display:flex;gap:8px;z-index:4';
  for(const child of toolbar.children)child.style.cssText='background:#222;color:#fff;border:1px solid #555;border-radius:18px;padding:8px;font:12px monospace';
  const observer=new ResizeObserver(()=>{
    const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);
    camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);
  });
  observer.observe(host);
  const start=performance.now();
  let previous=-1;
  const tick=(now)=>{
    if(disposed)return;
    const seconds=(now-start)/1000;
    if(meta.frames>1 && !reduced){
      const step=Math.floor(seconds*meta.fps)%(meta.frames+meta.firstFrameHold);
      const frame=step<=meta.firstFrameHold?0:step-meta.firstFrameHold;
      if(frame!==previous){drawFrame(frame);previous=frame}
    }
    root.userData.animate?.(now);
    controls.update();renderer.render(scene,camera);
    raf=requestAnimationFrame(tick);
  };
  raf=requestAnimationFrame(tick);
  return {destroy(){
    disposed=true;cancelAnimationFrame(raf);observer.disconnect();controls.dispose();
    root.traverse(o=>o.geometry?.dispose?.());material.dispose();texture.dispose();renderer.dispose();renderer.domElement.remove();toolbar.remove();
  }};
}
