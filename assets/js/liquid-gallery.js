/* Visual layer only. No changes to gallery fetch, filtering, previews or downloads. */
(() => {
  'use strict';
  const stage = document.querySelector('.liquid-subnav .island-stage');
  const grid = document.getElementById('grid');
  if (!stage || !grid) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = window.matchMedia('(pointer: coarse)');
  const markLanded = () => { stage.dataset.landed = 'true'; };
  if (reduced.matches) markLanded(); else setTimeout(markLanded, 840);

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
  reveal(grid);
  new MutationObserver(mutations => {
    for (const m of mutations) for (const node of m.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) reveal(node);
    }
  }).observe(grid, { childList: true, subtree: true });

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

  if (reduced.matches) return;
  const selector = 'input.search, .map-preview__resolution, .map-preview__zoom, .map-preview__helper, .lp-theater-enter, .lp-theater-exit, .chip, .btn, .card, .modal__close, .card__reload, .design-variant-arrow';
  const springs = new WeakMap();
  const searchRects = new WeakMap();
  const target = event => {
    const el = event.target instanceof Element ? event.target.closest(selector) : null;
    return el && el.closest('.liquid-subpage') ? el : null;
  };
  function spring(el, mode) {
    const fromScale = getComputedStyle(el).scale;
    const fromRotate = getComputedStyle(el).rotate;
    springs.get(el)?.cancel();
    const start = { scale: fromScale === 'none' ? '1' : fromScale,
      rotate: fromRotate === 'none' ? '0deg' : fromRotate };
    const hover = mode === 'enter';
    const click = mode === 'press';
    const small = el.matches('input.search');
    const finalScale = hover ? (small ? '1.003' : '1.025') :
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
    el.style.translate='0px 0px';
    el.style.setProperty('--lp-x', '0px'); el.style.setProperty('--lp-y', '0px');
    el.style.setProperty('--lp-rx', '0deg'); el.style.setProperty('--lp-ry', '0deg');
  }
  document.addEventListener('pointerover', e => {
    const el = target(e);
    if (!el || el.contains(e.relatedTarget)) return;
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
    spring(el,'leave');
  });
  document.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch' || coarse.matches) return;
    const el = target(e);
    if (!el || !el.matches(':hover')) return;
    const r = el.matches('input.search') ?
      (searchRects.get(el) || el.getBoundingClientRect()) : el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const x = Math.max(-1,Math.min(1,(e.clientX-r.left-r.width/2)/(r.width/2)));
    const y = Math.max(-1,Math.min(1,(e.clientY-r.top-r.height/2)/(r.height/2)));
    el.classList.add('lp-motion-target');
    const card = el.classList.contains('card');
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
  document.addEventListener('pointerdown', e => {
    const el = target(e);
    if (el) { el.classList.add('lp-motion-target'); spring(el,'press'); }
  });
  document.addEventListener('focusin', e => {
    const el = target(e);
    if (el) { el.classList.add('lp-motion-target'); spring(el,'enter'); }
  });
  document.addEventListener('focusout', e => {
    const el = target(e);
    if (el && !el.matches(':hover')) { resetTilt(el); spring(el,'leave'); }
  });
})();
