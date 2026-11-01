
// Progressive enhancements for Hive Resources. Does not replace data, downloads,
// navigation, map gestures or model-viewer controls.
(() => {
  const body = document.body;
  if (!body.classList.contains('hive-polished')) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const gallery = body.classList.contains('hive-gallery');
  const modal = document.querySelector('#modal');
  const viewer = document.querySelector('#modalViewer');

  const scrollThumb = () => {
    document.documentElement.classList.add('hive-scroll-active');
    clearTimeout(scrollThumb.timer);
    scrollThumb.timer = setTimeout(() =>
      document.documentElement.classList.remove('hive-scroll-active'), 1200);
  };
  window.addEventListener('scroll', scrollThumb, {passive:true});
  window.addEventListener('wheel', scrollThumb, {passive:true});
  window.addEventListener('touchmove', scrollThumb, {passive:true});

  const jump = document.createElement('button');
  jump.type='button';
  jump.className='hive-jump-top';
  jump.textContent='↑ TOP';
  jump.setAttribute('aria-label','Jump to gallery navigation');
  jump.tabIndex=-1;
  body.appendChild(jump);
  let lastY=window.scrollY, direction=1, clickingTop=false;
  const refreshJump=()=>{
    const y=window.scrollY;
    if(Math.abs(y-lastY)>3) direction=Math.sign(y-lastY);
    lastY=y;
    if(y<6) clickingTop=false;
    const visible = y>Math.max(420,innerHeight*.65) &&
      (direction<0 || clickingTop) && !modal?.classList.contains('is-open');
    jump.classList.toggle('is-visible',visible);
    jump.tabIndex=visible?0:-1;
  };
  window.addEventListener('scroll',refreshJump,{passive:true});
  jump.addEventListener('click',()=>{
    clickingTop=true;
    window.scrollTo({top:0,behavior:reduce.matches?'instant':'smooth'});
  });
  refreshJump();

  // Keep the original controls. Animate each real button after a native click
  // (never create the duplicate layer that caused mobile tap regressions).
  const controls='.chip,.btn,.topnav__btn,.topnav__dropitem,.topnav__burger,'+
    '.modal__close,.card__reload,.contrib,.hive-jump-top,.hero__quicklinks a';
  const animations=new WeakMap();
  let lastTouch=null;
  const selected=e=>e.target instanceof Element ? e.target.closest(controls):null;
  function bounce(el,mode='press',touch=false) {
    if(!el?.isConnected || reduce.matches) return;
    // Read the animated value BEFORE canceling. A short hover never snaps to
    // neutral when the cursor leaves partway through the spring.
    const style=getComputedStyle(el);
    const startScale=style.scale && style.scale!=='none' ? style.scale : '1';
    const startRotate=style.rotate && style.rotate!=='none' ? style.rotate : '0deg';
    animations.get(el)?.cancel();
    const hover=mode==='hover', leave=mode==='leave';
    const final=leave||touch?1:el.matches(':hover')?1.025:1;
    const initial={scale:startScale,rotate:startRotate};
    const frames=leave?
      [initial,{scale:'.988',rotate:'.25deg',offset:.50},{scale:'1',rotate:'0deg'}]:
      hover?
      [initial,{scale:'1.063',rotate:'-1deg',offset:.45},
       {scale:'.99',rotate:'.35deg',offset:.76},{scale:String(final),rotate:'0deg'}]:
      [initial,{scale:'.94',rotate:'1deg',offset:.24},
       {scale:'1.07',rotate:'-.8deg',offset:.60},
       {scale:'.99',rotate:'.2deg',offset:.82},{scale:String(final),rotate:'0deg'}];
    const motion=el.animate(frames,{
      duration:leave?290:hover?420:420,
      easing:'cubic-bezier(.2,.8,.3,1)',fill:'both'
    });
    animations.set(el,motion);
    motion.onfinish=()=>{
      if(animations.get(el)!==motion)return;
      // Hold the settled hover position; restore neutral on exit.
      el.style.scale=final===1?'':String(final);
      motion.cancel();
      animations.delete(el);
    };
  }
  document.addEventListener('pointerover',e=>{
    if(e.pointerType==='touch')return;
    const el=selected(e);
    if(el && !el.contains(e.relatedTarget))bounce(el,'hover');
  },true);
  document.addEventListener('pointerout',e=>{
    if(e.pointerType==='touch')return;
    const el=selected(e);
    if(el && !el.contains(e.relatedTarget))bounce(el,'leave');
  },true);
  document.addEventListener('pointerdown',e=>{
    const el=selected(e);
    if(el)lastTouch={el,label:el.textContent.trim(),parent:el.parentElement,
      time:performance.now(),id:e.pointerId,type:e.pointerType};
  },true);
  document.addEventListener('pointercancel',e=>{
    if(lastTouch?.id===e.pointerId)lastTouch=null;
  },true);
  document.addEventListener('click',e=>{
    const el=selected(e);
    if(!el)return;
    const touched=lastTouch &&
      (el===lastTouch.el || el.contains(lastTouch.el) || lastTouch.el.contains(el)) &&
      performance.now()-lastTouch.time<900;
    if(touched){
      const t=lastTouch;
      lastTouch=null;
      requestAnimationFrame(()=>{
        const live=t.el.isConnected?t.el:
          [...(t.parent?.querySelectorAll('button,a')||[])].find(x=>x.textContent.trim()===t.label);
        if(live?.isConnected)bounce(live,'press',t.type==='touch');
      });
    }else if(e.detail===0) {
      requestAnimationFrame(()=>{if(el.isConnected)bounce(el,'press')});
    }
  },true);

  // The visual motion module owns all reveal effects.
  if(!gallery)return;

  // Match the newer gallery search bars without modifying filter logic.
  const search=document.querySelector('#searchInput');
  const count=document.querySelector('#countLabel');
  if(search && count){
    const noun=body.classList.contains('maps-page')?'maps':'models';
    const measure=document.createElement('canvas').getContext('2d');
    const update=()=>{
      const n=count.textContent.match(/\d[\d,]*/)?.[0]||'0';
      search.placeholder='search '+n+' '+noun;
      const style=getComputedStyle(search);
      measure.font=style.fontSize+' '+style.fontFamily;
      const px=measure.measureText(search.value||search.placeholder).width;
      const max=search.parentElement.clientWidth-20;
      search.style.setProperty('--hive-search-width',
        Math.min(max,Math.max(175,Math.ceil(px+55)))+'px');
    };
    new MutationObserver(update).observe(count,{childList:true,characterData:true,subtree:true});
    search.addEventListener('input',update);
    window.addEventListener('resize',update,{passive:true});
    document.fonts?.ready.then(update);
    update();
  }

  if(!modal || !viewer)return;
  let chromeTimer=0;
  const showChrome=()=>{
    viewer.classList.add('hive-chrome-visible');
    clearTimeout(chromeTimer);
    chromeTimer=setTimeout(()=>viewer.classList.remove('hive-chrome-visible'),2100);
  };
  viewer.addEventListener('pointerenter',showChrome,{passive:true});
  viewer.addEventListener('pointermove',showChrome,{passive:true});
  viewer.addEventListener('pointerdown',showChrome,{passive:true});
  viewer.addEventListener('wheel',showChrome,{passive:true});
  viewer.addEventListener('focusin',showChrome);
  const fullscreen=document.createElement('button');
  fullscreen.type='button';
  fullscreen.className='hive-fullscreen-toggle';
  fullscreen.title='Fullscreen';
  fullscreen.setAttribute('aria-label','Fullscreen');
  const enterIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '+
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+
    '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/></svg>';
  const exitIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '+
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+
    '<path d="M3 9h6V3M21 9h-6V3M21 15h-6v6M3 15h6v6"/></svg>';
  const updateFullscreen=()=>{
    const full=modal.classList.contains('hive-fullscreen');
    fullscreen.innerHTML=full?exitIcon:enterIcon;
    fullscreen.title=full?'Exit fullscreen':'Fullscreen';
    fullscreen.setAttribute('aria-label',fullscreen.title);
    showChrome();
    window.dispatchEvent(new Event('resize'));
    setTimeout(()=>window.dispatchEvent(new Event('resize')),350);
  };
  const toggleFullscreen=()=>{
    modal.classList.toggle('hive-fullscreen');
    updateFullscreen();
  };
  fullscreen.addEventListener('click',e=>{e.stopPropagation();toggleFullscreen()});
  fullscreen.innerHTML=enterIcon;

  // Hive Maps rebuilds its own pan/zoom UI on each preview. Reuse the actual
  // controls and handlers; only their presentation moves to the toolbar.
  const reconcile=()=>{
    let toolbar=viewer.querySelector(':scope > .hive-preview-toolbar');
    if(!toolbar){
      toolbar=document.createElement('div');
      toolbar.className='hive-preview-toolbar';
      toolbar.setAttribute('role','group');
      toolbar.setAttribute('aria-label','Preview controls');
      viewer.appendChild(toolbar);
    }
    const shell=viewer.querySelector('.map-preview');
    const res=shell?.querySelector('.map-preview__resolution');
    const zoom=shell?.querySelector('.map-preview__controls');
    if(res && res.parentNode!==toolbar) toolbar.insertBefore(res,toolbar.firstChild);
    if(zoom && zoom.parentNode!==toolbar) toolbar.insertBefore(zoom,fullscreen.parentNode===toolbar?fullscreen:null);
    if(fullscreen.parentNode!==toolbar)toolbar.appendChild(fullscreen);
  };
  new MutationObserver(reconcile).observe(viewer,{childList:true});
  reconcile();
  let openedBefore=false;
  let modalSettleTimer=0;
  const updateOpenState=()=>{
    if(modal.classList.contains('is-open')){
      if(!openedBefore){
        openedBefore=true;
        clearTimeout(modalSettleTimer);
        modalSettleTimer=setTimeout(()=>{
          if(modal.classList.contains('is-open')) modal.classList.add('hive-opened');
        },370);
      }
    }else{
      openedBefore=false;
      clearTimeout(modalSettleTimer);
      // Avoid MutationObserver feedback: only change the class if present.
      if(modal.classList.contains('hive-opened')){
        modal.classList.remove('hive-opened');
      }
      if(modal.classList.contains('hive-fullscreen')){
        modal.classList.remove('hive-fullscreen');
        updateFullscreen();
      }
    }
  };
  new MutationObserver(updateOpenState).observe(modal,{
    attributes:true,attributeFilter:['class']
  });
  updateOpenState();
  window.addEventListener('keydown',e=>{
    if(e.key==='Escape' && modal.classList.contains('hive-fullscreen')){
      e.stopImmediatePropagation();e.preventDefault();
      toggleFullscreen();
    }
  },true);
  // Native scroll remains locked by the existing modal. The document gutter
  // is reserved by CSS, preventing a sudden horizontal shift.
})();
