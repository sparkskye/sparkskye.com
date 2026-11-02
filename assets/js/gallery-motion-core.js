/* Shared motion for all Sparkskye creation and Hive galleries. */
window.SparkGalleryMotion = window.SparkGalleryMotion || {};
// Shared gallery navigation. Page modules provide only data and openItem.
// Touch swipes must START outside the viewer; viewer drags/pinches stay native.
window.SparkGalleryMotion.registerNavigation = function registerNavigation(config) {
  const {modal, viewer, getItems, getCurrentId, getItemId, openItem} = config;
  if(!modal || !viewer || modal.dataset.sparkNavigationReady) return;
  modal.dataset.sparkNavigationReady='1';
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let motion=null, swipe=null, gestureTouches=new Set();
  const cancelMotion=()=>{motion?.cancel();motion=null};
  const navigate=direction=>{
    if(!modal.classList.contains('is-open') ||
       modal.classList.contains('hive-is-closing') ||
       modal.classList.contains('is-closing')) return;
    const items=getItems();
    const current=String(getCurrentId() || '');
    const index=items.findIndex(it=>String(getItemId(it) || '')===current);
    if(index<0 || !items[index+direction]) return;
    const wasAnimating=Boolean(motion);
    cancelMotion();
    openItem(items[index+direction]);
    if(wasAnimating || reduced.matches) return;
    const distance=direction*78;
    const frames=[
      {transform:`translateX(${distance}px)`,opacity:.18,offset:0},
      {transform:`translateX(${-direction*6}px)`,opacity:1,offset:.8},
      {transform:'translateX(0px)',opacity:1,offset:1}
    ];
    const opts={duration:340,easing:'cubic-bezier(.16,.82,.3,1)',fill:'both'};
    const viewerAnim=viewer.animate(frames,opts);
    const meta=modal.querySelector('.modal__meta');
    const metaAnim=meta?.animate(frames,{...opts,duration:370});
    const pair={cancel:()=>{viewerAnim.cancel();metaAnim?.cancel()}};
    motion=pair;
    const done=()=>{if(motion===pair){cancelMotion()}};
    (metaAnim||viewerAnim).onfinish=done;
  };
  window.addEventListener('keydown',event=>{
    if(event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
       !['ArrowLeft','ArrowRight'].includes(event.key) ||
       event.target.closest?.('input,textarea,select,[contenteditable=true]')) return;
    if(!modal.classList.contains('is-open')) return;
    event.preventDefault();
    navigate(event.key==='ArrowRight'?1:-1);
  });
  modal.addEventListener('pointerdown',event=>{
    if(event.pointerType!=='touch' || !modal.classList.contains('is-open')) return;
    gestureTouches.add(event.pointerId);
    if(gestureTouches.size>1){swipe=null;return}
    if(viewer.contains(event.target) ||
       event.target.closest('button,a,input,video,iframe')) return;
    swipe={id:event.pointerId,x:event.clientX,y:event.clientY};
  },true);
  modal.addEventListener('pointerup',event=>{
    if(event.pointerType!=='touch')return;
    const wasMulti=gestureTouches.size>1;
    gestureTouches.delete(event.pointerId);
    if(!swipe || swipe.id!==event.pointerId || wasMulti)return;
    const dx=event.clientX-swipe.x,dy=event.clientY-swipe.y;
    swipe=null;
    if(Math.abs(dx)>64 && Math.abs(dx)>Math.abs(dy)*1.35)
      navigate(dx<0?1:-1);
  },true);
  modal.addEventListener('pointercancel',event=>{
    gestureTouches.delete(event.pointerId);
    if(swipe?.id===event.pointerId)swipe=null;
  },true);
  modal.addEventListener('pointerdown',event=>{
    // Starting a new gesture on an item must not inherit the old swipe.
    if(event.pointerType==='mouse')swipe=null;
  },true);
};

window.SparkGalleryMotion.init = function initGalleryMotion(options) {
  'use strict';
  options = options || {};
  const stage = document.querySelector('.liquid-subnav .island-stage');
  const grid = document.getElementById('grid');
  // Hive home and Rewind have no grid, but still share page and button motion.
  if ((!grid && !options.hive) || document.body.dataset.galleryMotionReady) return;
  document.body.dataset.galleryMotionReady = '1';
  document.body.classList.add('gallery-motion');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = window.matchMedia('(pointer: coarse)');
  if (options.hive) {
    // The previous Hive-specific scroll listener was removed during the
    // shared-engine migration; restore it here for every Hive page.
    let scrollFade;
    const showScrollbar = () => {
      document.documentElement.classList.add('hive-scroll-active');
      clearTimeout(scrollFade);
      scrollFade = setTimeout(() => {
        document.documentElement.classList.remove('hive-scroll-active');
      }, 1350);
    };
    window.addEventListener('scroll', showScrollbar, {passive:true});
    window.addEventListener('wheel', showScrollbar, {passive:true});
    window.addEventListener('touchmove', showScrollbar, {passive:true});
  }
  const markLanded = () => { if(stage) stage.dataset.landed = 'true'; };
  if (reduced.matches) markLanded(); else setTimeout(markLanded, 840);


  // Hive's short heading bounces once. Long text and large panels fade/slide.
  if (options.hive && !reduced.matches) {
    const title = document.querySelector('.hero__title');
    if (title) {
      const fragment=document.createDocumentFragment();
      let i=0;
      for(const ch of title.textContent) {
        if (/\s/.test(ch)) { fragment.append(ch); continue; }
        const letter=document.createElement('span');
        letter.className='gm-title-char';
        letter.style.setProperty('--gm-delay',(55+i++*26)+'ms');
        letter.textContent=ch; fragment.append(letter);
      }
      title.replaceChildren(fragment);
    }
    const targets=document.querySelectorAll(
      '.topbar,.hero__sub,.hero__quicklinks,.hero__downloads,'+
      '.panel,.contributors,.latest,.contrib,.footer'
    );
    // Big containers rise as units; smaller children fade without moving
    // their parent and without making individual gallery tags bounce in.
    const secondary=document.querySelectorAll(
      '.topnav__btn,.panel__label,.panel__row,.footer > div,.footer__ai,'+
      '.hero__dot,.brand,.topnav__burger'
    );
    // One animation owner: CSS gallery-motion-core.css.
    // The observer chooses when an element enters, then removes itself.
    // No Web Animations API restart runs on initial page load.
    const pending = [];
    const io=typeof IntersectionObserver!=='undefined'
      ? new IntersectionObserver(entries=>entries.forEach(entry=>{
          if(!entry.isIntersecting)return;
          entry.target.classList.add('gm-visible');
          io.unobserve(entry.target);
        }),{threshold:.04,rootMargin:'0px 0px 80px 0px'})
      : null;
    targets.forEach((el,i)=>{
      if(el.id === 'filtersPanel')return;
      el.classList.add('gm-reveal');
      // A panel moves as a unit. Children fade without nested bounce.
      if(el.closest('.panel') && !el.classList.contains('panel'))
        el.classList.add('gm-fade-only');
      el.style.setProperty('--gm-delay',(Math.min(i,5)*55)+'ms');
      if(io) pending.push(el); else el.classList.add('gm-visible');
    });
    secondary.forEach((el,i)=>{
      if(el.classList.contains('gm-reveal'))return;
      el.classList.add('gm-reveal','gm-fade-only');
      el.style.setProperty('--gm-delay',Math.min(i%7,6)*42+170+'ms');
      if(io) pending.push(el); else el.classList.add('gm-visible');
    });
    // Allow the initial hidden layout to paint before revealing. Otherwise
    // IntersectionObserver can set both classes in the same frame and skip
    // the actual fade on fast/cached navigations.
    if(io) requestAnimationFrame(() => requestAnimationFrame(() => {
      pending.forEach(el => io.observe(el));
    }));

    // Use the EXACT hover timing, keyframes and interrupted-return behavior
    // of the homepage footer's social links (liquid-home.js).
    const socialSelector = '.hero__quicklinks a,.hero__downloads a,.footer a,.contrib__name,.brand__name';
    const socialLinks = [...document.querySelectorAll(socialSelector)];
    const letterState = new WeakMap();
    const colorTimers = new WeakMap();
    socialLinks.forEach(link => {
      const label=link.textContent.trim();
      if(!label) return;
      if(link.tagName === 'A') link.setAttribute('aria-label',label);
      const wrapper=document.createElement('span');
      wrapper.className='lp-label';
      // Non-anchor contributor/brand text must retain an accessible name.
      if(link.tagName === 'A') wrapper.setAttribute('aria-hidden','true');
      [...label].forEach((char,i) => {
        const letter=document.createElement('span');
        letter.className='lp-letter';
        letter.textContent=char;
        letter.style.setProperty('--lp-char',i);
        wrapper.append(letter);
      });
      link.replaceChildren(wrapper);
      link.classList.add('gm-social-link');
    });
    const animateSocial = (link, active) => {
      if(letterState.get(link)===active)return;
      letterState.set(link,active);
      (colorTimers.get(link)||[]).forEach(clearTimeout);
      const timers=[];
      colorTimers.set(link,timers);
      link.querySelectorAll('.lp-letter').forEach((letter,i)=>{
        const pose=getComputedStyle(letter).transform;
        letter.getAnimations().forEach(a=>a.cancel());
        const restColor='#ffffff', hoverColor='#00aaff';
        if(active){
          letter.style.color=restColor;
          const paint=()=>{if(letterState.get(link)===true)letter.style.color=hoverColor;};
          if(reduced.matches || i===0)paint();
          else timers.push(setTimeout(paint,i*27));
        }else letter.style.color=restColor;
        if(reduced.matches)return;
        const from=pose==='none'?'translateY(0px) scale(1)':pose;
        const frames=active?[
          {transform:from,offset:0},
          {transform:'translateY(-8px) scale(1.13)',offset:.46},
          {transform:'translateY(2px) scale(.975)',offset:.76},
          {transform:'translateY(0px) scale(1)',offset:1}
        ]:[
          {transform:from,offset:0},
          {transform:'translateY(2px) scale(.98)',offset:.52},
          {transform:'translateY(-1px) scale(1.01)',offset:.82},
          {transform:'translateY(0px) scale(1)',offset:1}
        ];
        const motion=letter.animate(frames,{
          duration:active?440:330,
          delay:active?i*27:i*6,
          easing:'ease-out',fill:'both'
        });
        motion.onfinish=()=>motion.cancel();
      });
    };
    socialLinks.forEach(link=>{
      // Contributor links respond when hovering the WHOLE contributor card.
      const control=link.matches('.contrib__name') ? (link.closest('.contrib')||link) : link;
      control.addEventListener('pointerenter',()=>animateSocial(link,true));
      control.addEventListener('pointerleave',()=>{
        if(document.activeElement!==control)animateSocial(link,false);
      });
      control.addEventListener('focus',()=>animateSocial(link,true));
      control.addEventListener('blur',()=>{
        if(!control.matches(':hover'))animateSocial(link,false);
      });
    });

    // Fresh navigations and reloads naturally create a new document and run
    // the CSS entrance ONCE. Only a back/forward-cache restore needs replay.
    window.addEventListener('pageshow',event=>{
      if(!event.persisted)return;
      const shown=pending.filter(el=>el.classList.contains('gm-visible'));
      shown.forEach(el=>el.classList.remove('gm-visible'));
      const restart=[
        ...document.querySelectorAll('.gm-title-char'),
        document.getElementById('filtersPanel'),
        document.getElementById('grid'),
        ...document.querySelectorAll('.lp-reveal-card')
      ].filter(Boolean);
      restart.forEach(el=>el.style.animation='none');
      // Flush the reset style once; replay after a single frame.
      void document.body.offsetHeight;
      requestAnimationFrame(()=>{
        restart.forEach(el=>el.style.removeProperty('animation'));
        shown.forEach(el=>{
          const rect=el.getBoundingClientRect();
          if(rect.bottom>0 && rect.top<innerHeight+80)
            el.classList.add('gm-visible');
          else if(io)io.observe(el);
          else el.classList.add('gm-visible');
        });
      });
    });
  }
  // Newly rendered cards and empty/loading messages enter as they arrive.
  // This also works for client-side filtering and late Cloudflare API results.
  const reveal = root => {
    const nodes = root.matches?.('.card, .empty-state, .grid__loading') ? [root] :
      [...root.querySelectorAll?.('.card, .empty-state, .grid__loading') || []];
    nodes.forEach((node, index) => {
      if (node.classList.contains('lp-reveal-card')) return;
      node.style.setProperty('--gallery-index', Math.min(index, 12));
      node.classList.add('lp-reveal-card');
    });
  };
  if (grid) {
    // Let Hive model-card entrance layers decompose after the animation.
    // Keeping animation-fill:both permanently on a WebGL canvas can cause
    // GPU-compositor edge trails whenever its border changes on hover.
    if (options.hive) {
      grid.addEventListener('animationend', e => {
        if (e.animationName === 'gm-card-arrive' &&
            e.target instanceof Element && e.target.matches('.card')) {
          e.target.classList.add('gm-card-settled');
        }
      });
    }
    reveal(grid);
    new MutationObserver(mutations => {
      for (const m of mutations) for (const node of m.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) reveal(node);
      }
    }).observe(grid, { childList: true, subtree: true });
  }

  // A small gallery shortcut appears only when scrolling UP after travelling
  // far enough down the page. It never obscures an open preview.
  const jumpTop = document.createElement('button');
  jumpTop.type = 'button';
  jumpTop.className = 'lp-jump-top chip';
  jumpTop.textContent = '↑ TOP';
  jumpTop.setAttribute('aria-label', 'Jump to gallery navigation');
  jumpTop.title = 'Return to gallery controls';
  document.body.appendChild(jumpTop);
  let lastScrollY = window.scrollY;
  let lastDirection = 0;
  let entranceAnimation = null;
  const updateJumpTop = () => {
    const y = window.scrollY || 0;
    const delta = y - lastScrollY;
    if (Math.abs(delta) > 3) lastDirection = Math.sign(delta);
    lastScrollY = y;
    const modalOpen = document.getElementById('modal')?.classList.contains('is-open');
    const show = y > Math.max(420, window.innerHeight * .65) && lastDirection < 0 && !modalOpen;
    const wasVisible = jumpTop.classList.contains('is-visible');
    if (!show && wasVisible) entranceAnimation?.cancel();
    jumpTop.classList.toggle('is-visible', show);
    if (show && !wasVisible && !reduced.matches) {
      entranceAnimation?.cancel();
      entranceAnimation = jumpTop.animate([
        {transform:'translateY(-18px) scale(.90)',opacity:0},
        {transform:'translateY(5px) scale(1.075)',opacity:1,offset:.48},
        {transform:'translateY(-3px) scale(.978)',opacity:1,offset:.75},
        {transform:'translateY(0) scale(1)',opacity:1}
      ],{duration:500,easing:'ease-out'});
    }
    jumpTop.tabIndex = show ? 0 : -1;
  };
  jumpTop.tabIndex = -1;
  window.addEventListener('scroll', updateJumpTop, {passive:true});
  window.addEventListener('resize', updateJumpTop, {passive:true});
  jumpTop.addEventListener('click', () => {
    // Keep the button visible through the press bounce. Normal scroll
    // activity hides it only after reaching the top of the page.
    window.scrollTo({top:0,behavior:reduced.matches?'instant':'smooth'});
  });
  updateJumpTop();

  // Shared floating preview controls fade after movement stops.
  const modal = document.getElementById('modal');
  const viewer = document.getElementById('modalViewer');
  if (modal && viewer) {
    let chromeTimer = 0;
    const revealChrome = () => {
      viewer.classList.add('lp-preview-active');
      modal.classList.add('lp-preview-active');
      clearTimeout(chromeTimer);
      chromeTimer = setTimeout(() => {
        viewer.classList.remove('lp-preview-active');
        modal.classList.remove('lp-preview-active');
      }, 2050);
    };
    viewer.addEventListener('pointerenter', revealChrome, { passive: true });
    viewer.addEventListener('pointermove', revealChrome, { passive: true });
    viewer.addEventListener('pointerdown', revealChrome, { passive: true });
    viewer.addEventListener('lp-preview-interaction', revealChrome);
    modal.addEventListener('pointermove', () => {
      if (modal.classList.contains('lp-theater')) revealChrome();
    }, { passive: true });
    modal.addEventListener('pointerdown', () => {
      if (modal.classList.contains('lp-theater')) revealChrome();
    }, { passive: true });
    modal.addEventListener('focusin', revealChrome);
  }

  // Proportional corner radii depend on image aspect ratio, not resolution.
  if (viewer) {
    const seen = new WeakSet();
    const setCorners = media => {
      const w = media.naturalWidth || media.videoWidth || 0;
      const h = media.naturalHeight || media.videoHeight || 0;
      if (w < 1 || h < 1) return;
      const r = Math.min(w, h) * .04;
      media.style.setProperty('--lp-radius-x', `${(r / w * 100).toFixed(3)}%`);
      media.style.setProperty('--lp-radius-y', `${(r / h * 100).toFixed(3)}%`);
    };
    const inspect = () => {
      viewer.querySelectorAll('img,video').forEach(media => {
        if (!seen.has(media)) {
          seen.add(media);
          media.addEventListener('load', () => setCorners(media));
          media.addEventListener('loadedmetadata', () => setCorners(media));
        }
        setCorners(media);
      });
    };
    inspect();
    new MutationObserver(inspect).observe(viewer, { childList:true, subtree:true });
  }

  // Use the content's true aspect ratio on roomy desktop windows. A
  // thumbnail can occupy a full 16:9 viewer instead of sitting in letterbox.
  // Never shrink the modal to make it fit: use the default constrained viewer
  // when there is not enough space around the expanded window.
  if (viewer && modal) {
    let fitFrame = 0;
    const fitViewer = () => {
      fitFrame = 0;
      if (!modal.classList.contains('is-open') || modal.classList.contains('lp-theater') ||
          window.innerWidth < 960 || window.innerHeight < 700) {
        viewer.removeAttribute('data-fluid-fit');
        viewer.style.removeProperty('--lp-fluid-viewer-height');
        return;
      }
      const img = viewer.querySelector('img.map-preview__img, img.modal__thumb');
      const video = viewer.querySelector('video');
      const iframe = viewer.querySelector('iframe');
      const ratio = img?.naturalWidth && img?.naturalHeight
        ? img.naturalWidth / img.naturalHeight
        : video?.videoWidth && video?.videoHeight
          ? video.videoWidth / video.videoHeight
          : iframe ? 16 / 9 : 0;
      const card = modal.querySelector('.modal__card');
      if (!card || ratio <= 0 || !Number.isFinite(ratio)) {
        viewer.removeAttribute('data-fluid-fit');
        viewer.style.removeProperty('--lp-fluid-viewer-height');
        return;
      }
      const width = viewer.clientWidth;
      const contentHeight = width / ratio;
      const otherHeight = card.offsetHeight - viewer.offsetHeight;
      const available = Math.min(850, window.innerHeight - 40 - otherHeight);
      if (contentHeight >= 220 && contentHeight <= available) {
        viewer.style.setProperty('--lp-fluid-viewer-height', `${Math.round(contentHeight)}px`);
        viewer.dataset.fluidFit = 'true';
      } else {
        viewer.removeAttribute('data-fluid-fit');
        viewer.style.removeProperty('--lp-fluid-viewer-height');
      }
    };
    const scheduleViewerFit = () => {
      if (!fitFrame) fitFrame = requestAnimationFrame(fitViewer);
    };
    new MutationObserver(scheduleViewerFit).observe(viewer, {childList:true,subtree:true});
    viewer.addEventListener('load', scheduleViewerFit, true);
    viewer.addEventListener('loadedmetadata', scheduleViewerFit, true);
    window.addEventListener('resize', scheduleViewerFit, {passive:true});
    scheduleViewerFit();
  }

  // Keep gallery result counts for filtering, display them in the search hint.
  const search = document.getElementById('searchInput');
  const countLabel = document.getElementById('countLabel');
  if (search && countLabel) {
    const noun = document.body.classList.contains('maps-page') ? 'maps' :
      document.body.classList.contains('models-page') ? 'models' :
      document.body.classList.contains('animation-page') ? 'animations' :
      document.body.classList.contains('editing-page') ? 'videos' :
      document.body.classList.contains('art-page') ? 'artworks' : 'designs';
    search.setAttribute('aria-label', `Search ${noun}`);
    const measure = document.createElement('canvas').getContext('2d');
    const updateWidth = () => {
      const style = getComputedStyle(search);
      measure.font = `${style.fontSize} ${style.fontFamily}`;
      const measured = measure.measureText(search.value || search.placeholder).width;
      const max = Math.max(150, search.parentElement.clientWidth - 24);
      search.style.setProperty('--lp-search-width', `${Math.min(max, Math.max(174, Math.ceil(measured + 58)))}px`);
    };
    const updatePlaceholder = () => {
      const count = countLabel.textContent.match(/\d[\d,]*/)?.[0] || '0';
      search.placeholder = `search ${count} ${noun}`;
      updateWidth();
    };
    search.addEventListener('input', updateWidth, {passive:true});
    window.addEventListener('resize', updateWidth, {passive:true});
    new MutationObserver(updatePlaceholder).observe(countLabel, {childList:true, characterData:true, subtree:true});
    document.fonts?.ready.then(updateWidth);
    updatePlaceholder();
  }

  if (reduced.matches) return;
  const selector = 'input.search, .map-preview__resolution, .map-preview__zoom, .map-preview__helper, .lp-theater-enter, .lp-theater-exit, .lp-jump-top, .chip, .btn, .card, .modal__close, .card__reload, .design-variant-arrow, .hive-fullscreen-toggle, .contrib, .topnav__btn, .topnav__dropitem, .topnav__burger, .hero__quicklinks a, .hero__downloads a, .footer a';
  const springs = new WeakMap();
  const searchRects = new WeakMap();
  const touchPressUntil = new WeakMap();
  const target = event => {
    const el = event.target instanceof Element ? event.target.closest(selector) : null;
    return el && el.closest('.gallery-motion') ? el : null;
  };
  function spring(el, mode, fromTouch = false) {
    // Moving/scaling a Hive card containing a live canvas can leave GPU
    // compositing trails. Animate the inset border overlay instead.
    if (el.classList.contains('card') &&
        document.body.classList.contains('hive-gallery')) {
      el.classList.toggle('gm-card-hover',mode !== 'leave');
      if(mode === 'press') {
        el.classList.remove('gm-card-press');
        void el.offsetWidth;
        el.classList.add('gm-card-press');
        setTimeout(()=>el.classList.remove('gm-card-press'),390);
      }
      return;
    }
    const fromScale = getComputedStyle(el).scale;
    const fromRotate = getComputedStyle(el).rotate;
    springs.get(el)?.cancel();
    const start = { scale: fromScale === 'none' ? '1' : fromScale,
      rotate: fromRotate === 'none' ? '0deg' : fromRotate };
    const hover = mode === 'enter';
    const click = mode === 'press';
    const small = el.matches('input.search');
    const finalScale = fromTouch ? '1' : hover ? (small ? '1.003' : '1.025') :
      (mode === 'leave' ? '1' : (el.matches(':hover') ? (small ? '1.003' : '1.025') : '1'));
    el.style.scale = finalScale;
    el.style.rotate = '0deg';
    let frames;
    if (click) frames = [start, {scale:'.935',rotate:'1.8deg',offset:.28},
      {scale:'1.065',rotate:'-1.2deg',offset:.65}, {scale:finalScale,rotate:'0deg'}];
    else if (hover) frames = [start, {scale:'1.065',rotate:'-1.3deg',offset:.42},
      {scale:'.99',rotate:'.55deg',offset:.73}, {scale:finalScale,rotate:'0deg'}];
    else frames = [start,{scale:'.985',rotate:'.4deg',offset:.58},{scale:'1',rotate:'0deg'}];
    if (el.matches('.card, input')) frames = frames.map(f => ({...f, rotate:'0deg'}));
    if (small) frames = frames.map(f => ({
      ...f, scale: f.scale === '1' ? '1' :
        (f.scale === finalScale ? finalScale : (mode === 'press' ? '.997' : '1.008'))
    }));
    const anim = el.animate(frames, { duration: click ? 410 : hover ? 440 : 300,
      easing:'ease-out', fill:'both'});
    springs.set(el,anim);
    anim.onfinish = () => { if (springs.get(el) === anim) { anim.cancel(); springs.delete(el); } };
  }
  function resetTilt(el) {
    if (el.classList.contains('card') &&
        document.body.classList.contains('hive-gallery')) return;
    el.style.translate='0px 0px';
    el.style.setProperty('--lp-x', '0px'); el.style.setProperty('--lp-y', '0px');
    el.style.setProperty('--lp-rx', '0deg'); el.style.setProperty('--lp-ry', '0deg');
  }
  document.addEventListener('pointerover', e => {
    const el = target(e);
    if (!el || el.contains(e.relatedTarget)) return;
    if (!(el.classList.contains('card') && document.body.classList.contains('hive-gallery')))
      el.classList.add('lp-motion-target','lp-motion-active');
    if (el.matches('input.search')) searchRects.set(el, el.getBoundingClientRect());
    if (e.pointerType !== 'touch') spring(el,'enter');
  });
  document.addEventListener('pointerout', e => {
    const el = target(e);
    if (!el || el.contains(e.relatedTarget)) return;
    resetTilt(el);
    searchRects.delete(el);
    el.classList.remove('lp-motion-active');
    if (e.pointerType === 'touch' && performance.now() < (touchPressUntil.get(el) || 0)) return;
    spring(el,'leave');
  });
  document.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' || coarse.matches) return;
    const el = target(e);
    if (!el || !el.matches(':hover') || el.classList.contains('lp-jump-top')) return;
    const r = el.matches('input.search') ?
      (searchRects.get(el) || el.getBoundingClientRect()) : el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const x = Math.max(-1,Math.min(1,(e.clientX-r.left-r.width/2)/(r.width/2)));
    const y = Math.max(-1,Math.min(1,(e.clientY-r.top-r.height/2)/(r.height/2)));
    if (!(el.classList.contains('card') && document.body.classList.contains('hive-gallery')))
      el.classList.add('lp-motion-target');
    const card = el.classList.contains('card');
    // Do not continuously transform Hive cards with WebGL thumbnails:
    // Chromium may leave cyan/colored canvas edge trails at fast speeds.
    // Whole-card hover and click springs still use the same shared code.
    if (card && document.body.classList.contains('hive-gallery')) return;
    if(card) el.style.translate = `${x*7}px ${y*5}px`;
    if (el.matches('input.search')) {
      // Use the original, untransformed bounds so the search field follows the
      // pointer instead of feeding its own movement back into the calculation.
      el.style.setProperty('--lp-x', `${(x * 6).toFixed(2)}px`);
      el.style.setProperty('--lp-y', `${(y * 3).toFixed(2)}px`);
      el.style.setProperty('--lp-rx', '0deg');
      el.style.setProperty('--lp-ry', '0deg');
      return;
    }
    if(el.matches('.design-variant-arrow')) return;
    el.style.setProperty('--lp-x', `${(x * (card ? 3.5 : 2.0)).toFixed(2)}px`);
    el.style.setProperty('--lp-y', `${(-2 + y * (card ? 2.5 : 1.5)).toFixed(2)}px`);
    el.style.setProperty('--lp-rx', `${(-y * (card ? 0 : 2)).toFixed(2)}deg`);
    el.style.setProperty('--lp-ry', `${(x * (card ? 0 : 2.3)).toFixed(2)}deg`);
  }, {passive:true});
  // Do not animate/transform a touch target before the browser delivers click.
  // A quick tap must activate the real control, not a cloned overlay.
  let lastTouchTap = null;
  document.addEventListener('pointerdown', e => {
    const el = target(e);
    if (!el) return;
    if (!(el.classList.contains('card') && document.body.classList.contains('hive-gallery')))
      el.classList.add('lp-motion-target');
    if (e.pointerType === 'touch') {
      touchPressUntil.set(el, performance.now()+620);
      lastTouchTap = { el, id:e.pointerId, x:e.clientX, y:e.clientY,
        time:performance.now(), parent:el.parentElement,
        label:el.textContent.trim() };
      return;
    }
    spring(el,'press');
  });
  // Wait for the real click handler to finish. Category filters often replace
  // their own DOM nodes synchronously, which previously canceled tap springs.
  // Find the replacement control by label and animate ONLY that real node.
  document.addEventListener('click', e => {
    const el = target(e);
    if (!el) return;
    const tapped = lastTouchTap;
    const isTouchClick = tapped && performance.now()-tapped.time < 850 &&
      (el === tapped.el || tapped.el.contains(el) || el.contains(tapped.el));
    if (isTouchClick) {
      lastTouchTap = null;
      requestAnimationFrame(() => {
        const live = tapped.el.isConnected ? tapped.el :
          [...(tapped.parent?.querySelectorAll('button, .chip, .btn') || [])]
            .find(item => item.textContent.trim() === tapped.label);
        if (!live?.isConnected) return; // Page navigation has already begun.
        touchPressUntil.set(live, performance.now()+650);
        live.classList.add('lp-motion-target');
        spring(live, 'press', true);
      });
    } else if (e.detail === 0) {
      requestAnimationFrame(() => { if (el.isConnected) spring(el,'press'); });
    }
  }, true);
  document.addEventListener('pointercancel', e => {
    if (lastTouchTap?.id===e.pointerId) lastTouchTap=null;
  }, true);
  document.addEventListener('focusin', e => {
    const el = target(e);
    if (el && performance.now() >= (touchPressUntil.get(el) || 0)) {
      el.classList.add('lp-motion-target'); spring(el,'enter');
    }
  });
  document.addEventListener('focusout', e => {
    const el = target(e);
    if (el && !el.matches(':hover') && performance.now() >= (touchPressUntil.get(el) || 0)) {
      resetTilt(el); spring(el,'leave');
    }
  });
};
