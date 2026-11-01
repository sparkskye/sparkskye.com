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
  const updateJumpTop = () => {
    const y = window.scrollY || 0;
    const delta = y - lastScrollY;
    if (Math.abs(delta) > 3) lastDirection = Math.sign(delta);
    lastScrollY = y;
    const modalOpen = document.getElementById('modal')?.classList.contains('is-open');
    const show = y > Math.max(420, window.innerHeight * .65) && lastDirection < 0 && !modalOpen;
    const wasVisible = jumpTop.classList.contains('is-visible');
    jumpTop.classList.toggle('is-visible', show);
    if (show && !wasVisible && !reduced.matches) {
      jumpTop.animate([
        {transform:'translate(-50%,-18px) scale(.90)',opacity:0},
        {transform:'translate(-50%,5px) scale(1.075)',opacity:1,offset:.48},
        {transform:'translate(-50%,-3px) scale(.978)',opacity:1,offset:.75},
        {transform:'translate(-50%,0) scale(1)',opacity:1}
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
    const noun = document.body.classList.contains('animation-page') ? 'animations' :
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
  const selector = 'input.search, .map-preview__resolution, .map-preview__zoom, .map-preview__helper, .lp-theater-enter, .lp-theater-exit, .lp-jump-top, .chip, .btn, .card, .modal__close, .card__reload, .design-variant-arrow';
  const springs = new WeakMap();
  const searchRects = new WeakMap();
  const touchPressUntil = new WeakMap();
  const target = event => {
    const el = event.target instanceof Element ? event.target.closest(selector) : null;
    return el && el.closest('.liquid-subpage') ? el : null;
  };
  function spring(el, mode, fromTouch = false) {
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
    if (e.pointerType === 'touch' && performance.now() < (touchPressUntil.get(el) || 0)) return;
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
  // Do not animate/transform a touch target before the browser delivers click.
  // A quick tap must activate the real control, not a cloned overlay.
  let lastTouchTap = null;
  document.addEventListener('pointerdown', e => {
    const el = target(e);
    if (!el) return;
    el.classList.add('lp-motion-target');
    if (e.pointerType === 'touch') {
      touchPressUntil.set(el, performance.now()+620);
      lastTouchTap = { el, id:e.pointerId, x:e.clientX, y:e.clientY, time:performance.now() };
      return;
    }
    spring(el,'press');
  });
  // Capture-click runs before gallery filter handlers and preserves ordinary
  // native activation. Only the ACTUAL button animates, never a visual clone.
  document.addEventListener('click', e => {
    const el = target(e);
    if (!el) return;
    if (lastTouchTap && performance.now()-lastTouchTap.time < 850) {
      const tapped = lastTouchTap;
      lastTouchTap = null;
      if (el===tapped.el || tapped.el.contains(el) || el.contains(tapped.el)) {
        spring(el,'press',true);
      }
    } else if (e.detail === 0) {
      // Keyboard / accessibility activation.
      spring(el,'press');
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
})();
