/*
 * Sparkskye liquid pixels — homepage + all four creation galleries.
 * Everything (surface, independent color fronts, tethers and droplets) is
 * rasterized on ONE 4-CSS-pixel canvas grid. No sub-grid colors or vectors.
 */
(() => {
  'use strict';
  const stage = document.querySelector('.island-stage');
  if (!stage) return;
  const canvas = stage.querySelector('.liquid-canvas');
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;
  const hit = stage.querySelector('.island-hit');
  const toggle = stage.querySelector('.island-toggle');
  const nav = stage.querySelector('#island-links');
  const links = [...nav.querySelectorAll('a')];
  const portraitZone = document.querySelector('.portrait-zone');
  const subpage = stage.hasAttribute('data-page');
  const portrait = document.querySelector('.portrait');
  const hint = document.querySelector('.island-hint');
  const detail = document.querySelector('.island-detail');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (!subpage) {
    // Home should always start with the clean island view, even on reload.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    const resetHome = () => {
      window.scrollTo(0, 0);
      document.body.classList.remove('lp-scrolled');
    };
    const revealCopy = () => {
      document.body.classList.toggle('lp-scrolled', window.scrollY > 44);
    };
    resetHome();
    window.addEventListener('pageshow', () => {
      resetHome();
      requestAnimationFrame(resetHome);
    });
    window.addEventListener('scroll', revealCopy, { passive: true });
  } else {
    // Preserve a stable native scrollbar gutter while the gallery modal locks
    // page scrolling. Auto-hide its colored thumb after scroll activity.
    let fadeTimer = 0;
    const showScrollThumb = () => {
      document.documentElement.classList.add('lp-scroll-active');
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => {
        document.documentElement.classList.remove('lp-scroll-active');
      }, 1100);
    };
    window.addEventListener('scroll', showScrollThumb, { passive: true });
    window.addEventListener('wheel', showScrollThumb, { passive: true });
    window.addEventListener('touchmove', showScrollThumb, { passive: true });
  }
  document.documentElement.classList.add('liquid-enhanced');
  const CELL = 4; // The one and only spatial resolution for every liquid effect.
  const BASE_COLOR = stage.dataset.baseColor || '#00aaff';
  const descriptions = {
    '/': 'back to the homepage',
    '/animations/': "2d and 3d animations i've made",
    '/editing/': 'my youtube videos',
    '/design/': 'thumbnails, profiles, banners, and other graphic design work',
    '/art/': 'pixel art, texture packs, and other arts'
  };

  // Letter spans are visual only; the unchanged link label remains accessible.
  // Do this once so the hover ripple stays independent of liquid physics.
  const socialLinks = [...document.querySelectorAll('.liquid-footer nav a')];
  function splitLabel(element, order = 0) {
    const label = element.textContent.trim();
    if (!label) return;
    element.setAttribute('aria-label', label);
    element.style.setProperty('--lp-link-order', order);
    const wrapper = document.createElement('span');
    wrapper.className = 'lp-label';
    wrapper.setAttribute('aria-hidden', 'true');
    [...label].forEach((char, i) => {
      const letter = document.createElement('span');
      letter.className = 'lp-letter';
      letter.textContent = char;
      letter.style.setProperty('--lp-char', i);
      wrapper.appendChild(letter);
    });
    element.replaceChildren(wrapper);
  }
  links.forEach(splitLabel);
  socialLinks.forEach(splitLabel);

  // Text motion is independent of the canvas. Return motions start from the
  // CURRENT pose, so leaving a link halfway through never snaps a letter.
  const headingTextNode = [...toggle.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
  if (headingTextNode) {
    const headingLabel = headingTextNode.textContent.trim();
    toggle.setAttribute('aria-label', `${headingLabel} — explore my work`);
    const word = document.createElement('span');
    word.className = 'lp-heading-word';
    word.setAttribute('aria-hidden', 'true');
    [...headingLabel].forEach((character, i) => {
      const letter = document.createElement('span');
      letter.className = 'lp-heading-letter';
      letter.textContent = character;
      letter.style.setProperty('--lp-char', i);
      word.appendChild(letter);
    });
    headingTextNode.replaceWith(word);
    // Fit complete title inside the liquid shape after fonts load or on resize.
    const fitCompactHeading = () => {
      toggle.style.fontSize = '';
      // Desktop styling already fits; only shrink when the navigation is compact.
      if (!smallScreen()) return;
      const preferred = parseFloat(getComputedStyle(toggle).fontSize) || 38;
      const available = Math.max(148, Math.min(
        smallScreen() ? 336 : 280, stage.clientWidth - (smallScreen() ? 20 : 32)
      ) - 28);
      const measured = word.getBoundingClientRect().width;
      if (measured > available && measured > 0) {
        toggle.style.fontSize = `${Math.max(26, preferred * available / measured)}px`;
      }
    };
    requestAnimationFrame(fitCompactHeading);
    document.fonts?.ready.then(fitCompactHeading);
    window.addEventListener('resize', fitCompactHeading, { passive: true });
  }

  const letterState = new WeakMap();
  const colorTimers = new WeakMap();
  function animateLetters(link, active, social = false) {
    const previous = letterState.get(link);
    if (previous === active) return;
    letterState.set(link, active);
    (colorTimers.get(link) || []).forEach(clearTimeout);
    const timers = [];
    colorTimers.set(link, timers);
    const letters = link.querySelectorAll('.lp-letter');
    letters.forEach((letter, i) => {
      const pose = getComputedStyle(letter).transform;
      letter.getAnimations().forEach(animation => animation.cancel());
      // Each letter snaps to its new color as its bounce starts. Never
      // interpolate through grey, and cancel pending snaps on a quick exit.
      const restColor = social ? '#ffffff' : '#10141c';
      const hoverColor = social ? '#00aaff' : '#ffffff';
      if (active) {
        letter.style.color = restColor;
        const paint = () => {
          if (letterState.get(link) === true) letter.style.color = hoverColor;
        };
        if (reduced.matches || i === 0) paint();
        else timers.push(setTimeout(paint, i * (social ? 27 : 36)));
      } else {
        letter.style.color = restColor;
      }
      if (reduced.matches) return;
      const from = pose === 'none' ? 'translateY(0px) scale(1)' : pose;
      const frames = active ? [
        { transform: from, offset: 0 },
        { transform: 'translateY(-8px) scale(1.13)', offset: .46 },
        { transform: 'translateY(2px) scale(.975)', offset: .76 },
        { transform: 'translateY(0px) scale(1)', offset: 1 }
      ] : [
        { transform: from, offset: 0 },
        { transform: 'translateY(2px) scale(.98)', offset: .52 },
        { transform: 'translateY(-1px) scale(1.01)', offset: .82 },
        { transform: 'translateY(0px) scale(1)', offset: 1 }
      ];
      const motion = letter.animate(frames, {
        duration: active ? 440 : 330,
        delay: active ? i * (social ? 27 : 36) : i * 6,
        easing: 'ease-out', fill: 'both'
      });
      motion.onfinish = () => motion.cancel();
    });
  }
  socialLinks.forEach(link => {
    link.addEventListener('pointerenter', () => animateLetters(link, true, true));
    link.addEventListener('pointerleave', () => {
      if (document.activeElement !== link) animateLetters(link, false, true);
    });
    link.addEventListener('focus', () => animateLetters(link, true, true));
    link.addEventListener('blur', () => {
      if (!link.matches(':hover')) animateLetters(link, false, true);
    });
  });

  let entryTimer = 0;
  function startLetterEntrance() {
    clearTimeout(entryTimer);
    stage.dataset.entering = 'true';
    if (reduced.matches) { stage.dataset.entering = 'false'; return; }
    entryTimer = setTimeout(() => { stage.dataset.entering = 'false'; }, 960);
  }

  // The island retains its original geometry. Only the transparent drawing
  // canvas expands to the viewport edges. All effects share one 4px grid.
  let width = 0, height = 0, cols = 0, rows = 0;
  let canvasLeft = 0, canvasTop = 0;
  const entranceStart = performance.now() / 1000 + 0.05;
  let entranceSpraySent = false;
  let detailBounce = null;
  let detailExitTimer = 0;
  let pixels, colors;
  let baseColor = [1, 3, 5].map(i => parseInt(BASE_COLOR.slice(i, i + 2), 16)), currentKey = BASE_COLOR;
  const colorFronts = []; // Older fronts keep spreading when another link is hovered.
  let open = false, expansion = 0, expansionSpeed = 0;
  let raf = 0, lastFrame = 0, clock = 0, lastImpulse = -Infinity;
  let lastPointer = null, collapseTimer = 0, revealTimer = 0;
  let touchTimeout = 0, activeTouchId = null, touchDragged = false;
  let touchDownAt = -Infinity, touchDownPosition = null, touchedLink = null;
  let suppressTouchClickUntil = 0;
  let suppressOpeningTap = false;
  let touchBeganCollapsed = false;
  let heldTouchLink = null;
  const TOUCH_OPEN_MS = 10000;
  function stopTouchTimer() { clearTimeout(touchTimeout); touchTimeout = 0; }
  function armTouchTimer() {
    stopTouchTimer();
    if (open) touchTimeout = setTimeout(() => { clearHeldTouchLink(); setOpen(false); }, TOUCH_OPEN_MS);
  }
  function clearHeldTouchLink() {
    if (heldTouchLink) animateLetters(heldTouchLink, false);
    heldTouchLink = null;
    touchedLink = null;
    showDescription(null);
  }
  let pointer = null; // Retain cursor position briefly beyond the island edge.
  const waves = [], droplets = [];
  const portraitMotion = { x: 0, y: 0, angle: 0, scale: 1, vx: 0, vy: 0,
    va: 0, vs: 0, tx: 0, ty: 0, ta: 0, ts: 1 };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const smallScreen = () => matchMedia('(max-width: 820px)').matches;
  const position = e => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left - width / 2, y: e.clientY - r.top - height / 2 };
  };
  function entranceScale(time) {
    if (reduced.matches) return 1;
    const t = clamp((time - entranceStart) / 0.70, 0, 1);
    // A quick, springy pop with a small overshoot, no sluggish viscosity.
    // Damped spring with a continuous overshoot and recoil; never clamp the
    // peak flat. Geometry below leaves room for its natural ~8% overshoot.
    return Math.max(.05, 1 - Math.exp(-8.8 * t) * Math.cos(11 * t));
  }
  function geometry() {
    const closedWidth = smallScreen()
      ? Math.min(336, (width - 32) / 1.09) : Math.min(280, width - 32);
    const openedWidth = smallScreen() ? (width - 32) / 1.09 : width - 200;
    const scale = entranceScale(clock || performance.now() / 1000);
    return {
      w: (closedWidth + (openedWidth - closedWidth) * expansion) * scale,
      h: (90 + ((smallScreen() ? 186 : 124) - 90) * expansion) * scale
    };
  }
  function distanceToIsland(x, y, g) {
    const r = 27;
    const qx = Math.abs(x) - (g.w / 2 - r);
    const qy = Math.abs(y) - (g.h / 2 - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
      + Math.min(Math.max(qx, qy), 0) - r;
  }
  function requestFrame() {
    if (!raf && !document.hidden) raf = requestAnimationFrame(draw);
  }
  function resize() {
    width = stage.clientWidth;
    height = stage.clientHeight;
    if (width < 2 || height < 2) return; // Ignore detached/hidden stages.
    // Position the transparent canvas in DOCUMENT coordinates, with its
    // left/right edges at the edges of the page. Vertically it spans from
    // the top edge to well below the island. Droplets disappear naturally,
    // not because a small simulation rectangle cut them off.
    const bounds = stage.getBoundingClientRect();
    const leftInDocument = bounds.left + window.scrollX;
    const topInDocument = bounds.top + window.scrollY;
    const drawingWidth = Math.max(window.innerWidth, document.documentElement.clientWidth);
    const drawingHeight = Math.max(window.innerHeight, topInDocument + height + 440);
    cols = Math.ceil(drawingWidth / CELL);
    rows = Math.ceil(drawingHeight / CELL);
    canvas.width = cols;
    canvas.height = rows;
    canvasLeft = -leftInDocument;
    canvasTop = -topInDocument;
    canvas.style.left = `${canvasLeft}px`;
    canvas.style.top = `${canvasTop}px`;
    canvas.style.width = `${cols * CELL}px`;
    canvas.style.height = `${rows * CELL}px`;
    ctx.imageSmoothingEnabled = false;
    pixels = ctx.createImageData(cols, rows);
    colors = new Uint8ClampedArray(cols * rows * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set(baseColor, i);
    // Clear transitions on resize: keep the most recently selected color.
    baseColor = rgb(currentKey);
    colorFronts.length = 0;
    requestFrame();
  }
  function setColor(key, x = 0, y = 0) {
    if (key === currentKey) return;
    currentKey = key;
    // Do not take a snapshot of the previous frame. That used to freeze a
    // wave when another button was entered before the first wave had spread.
    colorFronts.push({ x, y, start: performance.now() / 1000,
      color: rgb(key) });
    requestFrame();
  }
  function commitCompletedFronts(time) {
    // A fully spread front covers everything before it, so only then can
    // its predecessors be discarded. Later fronts remain fully independent.
    for (let i = colorFronts.length - 1; i >= 0; i--) {
      const f = colorFronts[i];
      const maxX = Math.max(Math.abs(-width / 2 - f.x), Math.abs(width / 2 - f.x));
      const maxY = Math.max(Math.abs(-height / 2 - f.y), Math.abs(height / 2 - f.y));
      if ((time - f.start) * 355 > Math.hypot(maxX, maxY) + 14) {
        baseColor = f.color;
        colorFronts.splice(0, i + 1);
        break;
      }
    }
  }
  function showDescription(link) {
    if (!detail) return; // Gallery pages deliberately omit supporting copy.
    const href = link?.getAttribute('href')?.split(/[?#]/)[0];
    const copy = href ? descriptions[href] || '' : '';
    clearTimeout(detailExitTimer);
    if (!copy) {
      // Allow an in-progress bounce to FINISH its departure from the current
      // position, even if the pointer only touched the link for one frame.
      if (!detail.textContent.trim()) return;
      const opacity = getComputedStyle(detail).opacity;
      const transform = getComputedStyle(detail).transform;
      detailBounce?.cancel();
      detail.classList.remove('is-visible');
      detailBounce = reduced.matches ? null : detail.animate([
        { opacity, transform: transform === 'none' ? 'translateY(0)' : transform },
        { opacity: 0, transform: 'translateY(7px) scale(.97)' }
      ], { duration: 290, easing: 'ease-out', fill: 'forwards' });
      detailExitTimer = setTimeout(() => {
        detailBounce?.cancel(); detailBounce = null;
        detail.textContent = '';
      }, reduced.matches ? 0 : 300);
      return;
    }
    detailBounce?.cancel();
    detail.textContent = copy;
    detail.style.color = link.dataset.color || '#d1d1d1';
    detail.classList.add('is-visible');
    if (!reduced.matches) {
      detailBounce = detail.animate([
        { opacity: 0, transform: 'translateY(14px) scale(.94)', offset: 0 },
        { opacity: 1, transform: 'translateY(-5px) scale(1.04)', offset: .55 },
        { opacity: 1, transform: 'translateY(2px) scale(.985)', offset: .78 },
        { opacity: 1, transform: 'translateY(0) scale(1)', offset: 1 }
      ], { duration: 490, easing: 'ease-out', fill: 'both' });
      detailBounce.onfinish = () => { detailBounce?.cancel(); detailBounce = null; };
    }
  }
  // Sequence title vs menu: the last outgoing button disappears before the
  // compact page name springs back letter by letter. No overlap on quick exits.
  let hideTimer = 0, headingTimer = 0, headingSettleTimer = 0;
  function hideHeading() {
    clearTimeout(headingTimer); clearTimeout(headingSettleTimer);
    stage.dataset.heading = 'leaving';
    headingTimer = setTimeout(() => {
      if (open) stage.dataset.heading = 'hidden';
    }, reduced.matches ? 0 : 195);
  }
  function revealHeading(delay) {
    clearTimeout(headingTimer); clearTimeout(headingSettleTimer);
    stage.dataset.heading = 'hidden';
    headingTimer = setTimeout(() => {
      if (open) return;
      stage.dataset.heading = 'entering';
      headingSettleTimer = setTimeout(() => {
        if (!open) stage.dataset.heading = 'visible';
      }, reduced.matches ? 0 : 960);
    }, reduced.matches ? 0 : delay);
  }
  stage.dataset.heading = 'hidden';
  function setOpen(value) {
    clearTimeout(collapseTimer);
    if (!value) { stopTouchTimer(); clearHeldTouchLink(); }
    if (open === value) return;
    clearTimeout(revealTimer);
    clearTimeout(entryTimer);
    clearTimeout(hideTimer);
    stage.dataset.entering = 'false';
    open = value;
    stage.dataset.open = String(value);
    toggle.setAttribute('aria-expanded', String(value));
    nav.inert = !value;
    links.forEach(link => { link.tabIndex = value ? 0 : -1; });
    if (value) {
      hideHeading();
      stage.dataset.retracting = 'false';
      stage.dataset.ready = 'false';
      revealTimer = setTimeout(() => {
        if (!open) return;
        stage.dataset.ready = 'true';
        startLetterEntrance();
      }, reduced.matches ? 0 : 235);
    } else {
      // Keep labels visible for a short exit animation while the canvas
      // springs shut; do not instantly switch the nav to visibility:hidden.
      stage.dataset.retracting = 'true';
      links.forEach(link => { animateLetters(link, false); letterState.delete(link); });
      hideTimer = setTimeout(() => {
        stage.dataset.ready = 'false';
        stage.dataset.retracting = 'false';
      }, reduced.matches ? 0 : 290);
      showDescription(null);
      revealHeading(340);
      setColor(BASE_COLOR);
    }
    if (hint) hint.textContent = value ? 'pick a little piece of my world' : 'hover or tap to explore';
    requestFrame();
  }

  nav.inert = true;
  links.forEach(link => { link.tabIndex = -1; });
  hit.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') setOpen(true); });
  hit.addEventListener('pointerleave', e => {
    if (e.pointerType === 'touch' || activeTouchId !== null) return;
    collapseTimer = setTimeout(() => {
      if (!hit.contains(document.activeElement)) setOpen(false);
    }, 370);
  });
  toggle.addEventListener('click', e => {
    // A touch opens the menu and keeps it open; a mouse retains toggle.
    if (e.pointerType === 'touch' || performance.now() - touchDownAt < 650) {
      setOpen(true); armTouchTimer();
    } else setOpen(!open);
  });
  toggle.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault(); setOpen(true);
      clearTimeout(revealTimer); stage.dataset.ready = 'true'; links[0].focus();
    }
  });
  hit.addEventListener('focusout', () => setTimeout(() => {
    if (activeTouchId !== null || touchTimeout) return;
    if (!hit.contains(document.activeElement) && !hit.matches(':hover')) setOpen(false);
  }, 0));
  document.addEventListener('pointerdown', e => {
    if (!hit.contains(e.target)) setOpen(false);
  });
  // Touch gestures don't generate desktop hover events. Model finger movement
  // as pointer movement, and activate whichever link the finger is over.
  // Short taps are still ordinary links; drags never navigate accidentally.
  hit.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    // First tap always opens the island, even if a link occupies the same coordinates.
    suppressOpeningTap = !open;
    touchBeganCollapsed = !open;
    clearHeldTouchLink();
    // First tap never activates buttons hidden under the compact island.
    links.forEach(link => animateLetters(link, false));
    activeTouchId = e.pointerId;
    touchDownAt = performance.now();
    touchDownPosition = { x: e.clientX, y: e.clientY };
    touchDragged = false;
    lastPointer = { ...position(e), t: e.timeStamp/1000 };
    stopTouchTimer();
    setOpen(true);
    if (width && height && !reduced.matches) {
      const p = position(e);
      const t = performance.now()/1000;
      emitRipple(p.x, p.y, 0, -1, 130, t, true);
      // Three light flecks, made with the existing 4px droplet renderer.
      for (const d of [[-19,-26,-35,-65,5],[14,-22,40,-75,5],[0,17,20,62,4]]) {
        droplets.push({ax:p.x,ay:p.y,x:p.x+d[0],y:p.y+d[1],
          vx:d[2],vy:d[3],r:d[4],born:t,lifetime:.38,
          color:colorAt(p.x,p.y),tether:false,attached:false});
      }
      requestFrame();
    }
  });
  // Suppress only clicks created by dragging across the island. Taps on
  // actual links remain fully functional on phones.
  hit.addEventListener('click', e => {
    if (suppressOpeningTap || (performance.now() < suppressTouchClickUntil && e.detail !== 0)) {
      e.preventDefault(); e.stopImmediatePropagation();
      suppressOpeningTap = false;
    }
  }, true);
  window.addEventListener('pointerup', e => {
    if (e.pointerId !== activeTouchId) return;
    if (touchDragged) suppressTouchClickUntil = performance.now() + 380;
    activeTouchId = null; lastPointer = null; pointer = null;
    if (!touchBeganCollapsed && touchedLink && touchDragged) {
      heldTouchLink = touchedLink;
      links.forEach(link => animateLetters(link, link === heldTouchLink));
      showDescription(heldTouchLink);
    } else clearHeldTouchLink();
    touchedLink = null;
    touchBeganCollapsed = false;
    armTouchTimer();
  });
  window.addEventListener('pointercancel', e => {
    if (e.pointerId !== activeTouchId) return;
    activeTouchId = null; lastPointer = null; pointer = null;
    touchBeganCollapsed = false;
    clearHeldTouchLink();
    armTouchTimer();
  });
  hit.addEventListener('keydown', e => {
    if (e.key === 'Escape') { setOpen(false); toggle.focus(); }
    const index = links.indexOf(document.activeElement);
    if (index < 0) return;
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
    links[e.key === 'Home' ? 0 : e.key === 'End' ? links.length - 1 :
      (index + step + links.length) % links.length].focus();
  });
  links.forEach(link => {
    function activate(x, y) { setColor(link.dataset.color, x, y); showDescription(link); }
    link.addEventListener('pointerenter', e => {
      // Touch pointerenter may be fired before the first tap opens the island.
      // Only finger DRAG within an already expanded menu selects a page.
      if (e.pointerType === 'touch' || !open || stage.dataset.ready !== 'true') return;
      const pt = position(e);
      if (e.pointerType !== 'touch') {
        links.forEach(other => { if (other !== link) animateLetters(other, false); });
      }
      animateLetters(link, true);
      activate(pt.x, pt.y);
    });
    link.addEventListener('focus', () => {
      if (activeTouchId !== null || performance.now() - touchDownAt < 700) return;
      const r = link.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      animateLetters(link, true);
      activate(r.left + r.width / 2 - s.left - width / 2,
        r.top + r.height / 2 - s.top - height / 2);
    });
    link.addEventListener('pointerleave', e => {
      if (e.pointerType === 'touch' || activeTouchId !== null) return;
      if (document.activeElement !== link) {
        animateLetters(link, false);
        showDescription(null);
      }
    });
    link.addEventListener('blur', () => {
      if (!link.matches(':hover') && heldTouchLink !== link) {
        animateLetters(link, false);
        showDescription(null);
      }
    });
  });


  let pull = null, returningBlob = null;
  function splash(p, strength=650) {
    if (reduced.matches) return;
    const t=performance.now()/1000;
    emitRipple(p.x,p.y,0,-1,strength,t,true);
    for(let i=0;i<5;i++) {
      const a=Math.random()*Math.PI*2; const speed=65+Math.random()*160;
      droplets.push({ax:p.x,ay:p.y,x:p.x,y:p.y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,r:3+Math.random()*9,born:t,lifetime:.65,color:colorAt(p.x,p.y),tether:false,attached:false});
    }
    requestFrame();
  }
  hit.addEventListener('pointerdown',e=>{
    if(e.button!==0) return;
    splash(position(e));
    const link=e.target.closest('#island-links a') || hit;
    if(link) {
      pull={link,captureTarget:link,id:e.pointerId,x:e.clientX,y:e.clientY,
        dx:0,dy:0,moved:false};
      link.setPointerCapture(e.pointerId);
    }
  });
  hit.addEventListener('dragstart',e=>e.preventDefault());
  window.addEventListener('pointermove',e=>{
    if(!pull || pull.id!==e.pointerId) return;
    clearTimeout(collapseTimer);
    const ux=e.clientX-pull.x, uy=e.clientY-pull.y, distance=Math.hypot(ux,uy);
    const stretch=110*(1-Math.exp(-distance/180));
    pull.dx=distance?ux/distance*stretch:0; pull.dy=distance?uy/distance*stretch:0;
    if(Math.hypot(pull.dx,pull.dy)>6) pull.moved=true;
    // Finger dragging moves the label just as mouse dragging does.
    // The first tap on a collapsed island still cannot drag a hidden link.
    if(!reduced.matches && pull.link!==hit && !(e.pointerType==='touch' && touchBeganCollapsed)) {
      pull.link.style.translate=pull.dx+'px '+pull.dy+'px';
      const scaleX=1+Math.abs(pull.dx)/(e.pointerType==='touch'?390:260);
      const scaleY=1+Math.abs(pull.dy)/(e.pointerType==='touch'?370:220);
      pull.link.style.scale=scaleX+' '+scaleY;
    }
  });
  function releasePull(e) {
    if(!pull || e.pointerId!==pull.id) return;
    const p=pull; pull=null;
    if(p.moved) suppressTouchClickUntil=performance.now()+450;
    p.link.style.translate=''; p.link.style.scale='';
    if(!reduced.matches && p.moved && p.link!==hit) p.link.animate([
      {translate:p.dx+'px '+p.dy+'px',scale:'1.2'},
      {translate:(-p.dx*.22)+'px '+(-p.dy*.22)+'px',scale:'.92',offset:.45},
      {translate:(p.dx*.08)+'px '+(p.dy*.08)+'px',scale:'1.04',offset:.72},
      {translate:'0px 0px',scale:'1'}],{duration:620,easing:'ease-out'});
    if(p.moved && !reduced.matches) {
      const r=stage.getBoundingClientRect();
      const ax=p.x-r.left-width/2, ay=p.y-r.top-height/2;
      const px=p.fx??p.dx, py=p.fy??p.dy;
      const color=rgb(currentKey);
      returningBlob={ ax,ay,x:px,y:py, vx:p.vx??0,vy:p.vy??0,
        r:24,color,age:0,merge:0,merged:false };
      // Initial release disturbs the liquid around the moving pool.
      poolBurst(ax+px, ay+py, color, performance.now()/1000, .62);
      requestFrame();
    }
    if(p.captureTarget?.hasPointerCapture(p.id))
      p.captureTarget.releasePointerCapture(p.id);
    if (e.pointerType !== 'touch') {
      // Captured drag events can skip pointerleave. Reconcile every letter
      // with the actual cursor location, never the stale captured target.
      const hovered = document.elementFromPoint(e.clientX, e.clientY)?.closest('#island-links a');
      const active = open && links.includes(hovered) ? hovered : null;
      links.forEach(link => animateLetters(link, link === active));
      showDescription(active);
    }
  }
  window.addEventListener('pointerup',releasePull);
  window.addEventListener('pointercancel',releasePull);
  function colorAt(x, y) {
    const cx = clamp(Math.floor((x + width / 2 - canvasLeft) / CELL), 0, cols - 1);
    const cy = clamp(Math.floor((y + height / 2 - canvasTop) / CELL), 0, rows - 1);
    return [...colors.slice((cy * cols + cx) * 3, (cy * cols + cx) * 3 + 3)];
  }
  function emitDroplets(x, y, dirX, dirY, speed, time) {
    if (reduced.matches) return;
    const vigor = clamp((speed - 55) / 1500, 0, 1);
    const radius = 8 + vigor * 9; // Intermediate between tiny flecks and heavy blobs.
    const color = colorAt(x, y);
    const norm = Math.hypot(dirX, dirY) || 1;
    const dx = dirX / norm, dy = dirY / norm;
    const impulse = 92 + vigor * 180;
    // While attached, the main droplet follows the cursor a short distance.
    // The neck pinches off quickly instead of drawing a long viscous string.
    droplets.push({ ax: x, ay: y, x, y, vx: dx * impulse,
      vy: dy * impulse, r: radius, born: time,
      lifetime: .68 + vigor * .17, color, tether: true, attached: true });
    if (vigor > .52) {
      droplets.push({ ax: x, ay: y, x: x - dy * 6, y: y + dx * 6,
        vx: dx * (65 + vigor * 115) - dy * 36,
        vy: dy * (65 + vigor * 115) + dx * 36,
        r: 4 + vigor * 4, born: time + .045,
        lifetime: .56, color, tether: false, attached: false });
    }
    if (droplets.length > 30) droplets.splice(0, droplets.length - 30);
  }
  function emitRipple(x, y, dx, dy, speed, time, edge = false) {
    if (time - lastImpulse < (edge ? .018 : .047)) return;
    lastImpulse = time;
    waves.push({ x, y, dx, dy, start: time,
      power: clamp((edge ? 11 : 4.5) + speed * .009, 4.5, 25) });
    if (waves.length > 18) waves.shift();
  }
  // A broader splash when a pulled pool releases and when it rejoins the island.
  function poolBurst(x, y, color, time, strength=1) {
    waves.push(
      {x,y,dx:0,dy:-1,start:time,power:26*strength},
      {x,y,dx:1,dy:.25,start:time+.10,power:18*strength}
    );
    if (waves.length > 18) waves.splice(0,waves.length-18);
    // Irregular spray like the island entrance: a few large lobes and some
    // tiny flecks, with unequal spacing, timing, travel and direction.
    const count = strength > .95 ? 6 : 3;
    const heading = Math.random() * Math.PI * 2;
    for (let i=0; i<count; i++) {
      const angle = heading + (Math.random()-.5) * Math.PI * 1.85;
      const distance = 5 + Math.random()*24;
      const speed = (35 + Math.random()*185) * strength;
      const radius = Math.random() < .27
        ? 10 + Math.random()*7 : 2.5 + Math.random()*6.5;
      droplets.push({
        ax:x, ay:y,
        x:x+Math.cos(angle)*distance, y:y+Math.sin(angle)*distance,
        vx:Math.cos(angle)*speed, vy:Math.sin(angle)*speed,
        r:radius, born:time+Math.random()*.09,
        lifetime:.42+Math.random()*.46,
        color:[...color], tether:false, attached:false
      });
    }
    if (droplets.length>50) droplets.splice(0,droplets.length-50);
    requestFrame();
  }
  function emitEntranceSplash(time) {
    if (reduced.matches || entranceSpraySent) return;
    entranceSpraySent = true;
    // Three little cells of spray detach as the island appears. They reuse
    // the EXACT droplet renderer as pointer-made droplets.
    const spray = [{x:-115,y:-19,vx:-210,vy:-100,r:13},{x:82,y:-34,vx:90,vy:-190,r:7},{x:119,y:23,vx:230,vy:62,r:10},{x:-40,y:39,vx:-45,vy:110,r:5},{x:35,y:-40,vx:30,vy:-120,r:4}];
    waves.push({x:-100,y:0,dx:-1,dy:0,start:time+.07,power:30},{x:70,y:30,dx:1,dy:1,start:time+.22,power:18});
    for (const s of spray) {
      droplets.push({ ax: s.x, ay: s.y, x: s.x, y: s.y,
        vx: s.vx, vy: s.vy, r: s.r, born: time,
        lifetime: .85, color: rgb(BASE_COLOR),
        tether: false, attached: false });
    }
    waves.push({ x: 0, y: 0, dx: 1, dy: .2,
      start: time, power: 25 });
  }

  function processPointer(e) {
    if (reduced.matches || !width || !height) return;
    const isTouch = e.pointerType === 'touch';
    if (isTouch && e.pointerId !== activeTouchId) return;
    if (isTouch && !touchBeganCollapsed && touchDownPosition &&
        Math.hypot(e.clientX-touchDownPosition.x, e.clientY-touchDownPosition.y)>9) {
      touchDragged = true;
      // Keep the menu open while the finger is actively dragging.
      stopTouchTimer();
      const element = document.elementFromPoint(e.clientX, e.clientY);
      const link = element?.closest('#island-links a') || null;
      // Keep the last selected page while the finger moves away to release.
      if (link && link !== touchedLink && stage.dataset.ready === 'true') {
        if (touchedLink) animateLetters(touchedLink, false);
        touchedLink = link;
        if (pull?.id === e.pointerId && pull.link !== link) {
          if (pull.link !== hit) {
            pull.link.style.translate = '';
            pull.link.style.scale = '';
          }
          pull.link = link;
        }
        if (link) {
          const p = position(e);
          animateLetters(link, true);
          setColor(link.dataset.color, p.x, p.y);
          showDescription(link);
        }
      }
    }
    const r = stage.getBoundingClientRect();
    const x = e.clientX - r.left - width / 2;
    const y = e.clientY - r.top - height / 2;
    const time = e.timeStamp / 1000;
    // Window-level tracking preserves fast moves beyond the island and across
    // overlapping link elements, even when the next event is outside the stage.
    const near = isTouch || (e.clientX >= r.left - 130 && e.clientX <= r.right + 130 &&
      e.clientY >= r.top - 130 && e.clientY <= r.bottom + 130);
    pointer = near ? { x, y, t: time } : null;
    if (lastPointer) {
      const vx = x - lastPointer.x, vy = y - lastPointer.y;
      const distance = Math.hypot(vx, vy);
      const elapsed = time - lastPointer.t;
      const dt = clamp(elapsed, .008, .13);
      const speed = Math.min(2800, distance / dt);
      if (distance > .5 && elapsed < .55 && distance < 1600) {
        const ux = vx / distance, uy = vy / distance;
        const g = geometry();
        // Sample long pointer segments. A fast flick can cross the entire
        // island between two pointer events, so endpoints alone aren't enough.
        const steps = Math.min(65, Math.max(1, Math.ceil(distance / 11)));
        let prevX = lastPointer.x, prevY = lastPointer.y;
        let prevD = distanceToIsland(prevX, prevY, g);
        let emitted = false;
        for (let i = 1; i <= steps; i++) {
          const f = i / steps;
          const sx = lastPointer.x + vx * f;
          const sy = lastPointer.y + vy * f;
          const nextD = distanceToIsland(sx, sy, g);
          if (prevD <= 0 && nextD > 0 && !emitted) {
            // Interpolate the actual exit on the single-pixel-grid shape.
            const fraction = clamp(-prevD / (nextD - prevD), 0, 1);
            const ex = prevX + (sx - prevX) * fraction;
            const ey = prevY + (sy - prevY) * fraction;
            emitDroplets(ex, ey, ux, uy, speed, time);
            emitRipple(ex, ey, ux, uy, speed, time, true);
            emitted = true;
          }
          prevX = sx; prevY = sy; prevD = nextD;
        }
        // Light surface ripples follow the cursor instead of dragging behind.
        const surface = Math.abs(distanceToIsland(x, y, g));
        if (surface < 58 && speed > 15)
          emitRipple(x, y, ux, uy, speed, time);
      }
    }
    lastPointer = near ? { x, y, t: time } : null;
    requestFrame();
  }
  window.addEventListener('pointermove', processPointer, { passive: true });
  window.addEventListener('blur', () => { lastPointer = null; pointer = null; });

  // The portrait's untransformed wrapper prevents bounding-box feedback.
  portraitZone?.addEventListener('pointerenter', () => {
    if (reduced.matches) return;
    portraitMotion.vy = -100;
    portraitMotion.vs = 1.3;
    portraitMotion.ts = 1.1;
    requestFrame();
  });
  portraitZone?.addEventListener('pointermove', e => {
    if (reduced.matches) return;
    const r = portraitZone.getBoundingClientRect();
    const x = clamp((e.clientX - r.left - r.width / 2) / (r.width / 2), -1, 1);
    const y = clamp((e.clientY - r.top - r.height / 2) / (r.height / 2), -1, 1);
    Object.assign(portraitMotion, { tx: x * 13, ty: y * 11 - 3,
      ta: x * 10, ts: 1.085 });
    requestFrame();
  });
  portraitZone?.addEventListener('pointerleave', () => {
    Object.assign(portraitMotion, { tx: 0, ty: 0, ta: 0, ts: 1 });
  });

  // Pure cell-based rasterization: all coordinates below become INTEGER grid
  // indices. This never creates smaller color pixels than the island pixels.
  function dot(x, y, rx, ry, color) {
    const cx = (x + width / 2 - canvasLeft) / CELL;
    const cy = (y + height / 2 - canvasTop) / CELL;
    const ax = Math.max(1.1, rx / CELL), ay = Math.max(1.1, ry / CELL);
    ctx.fillStyle = `rgb(${color.join(',')})`;
    for (let iy = Math.max(0, Math.floor(cy - ay)); iy <= Math.min(rows - 1, Math.ceil(cy + ay)); iy++) {
      for (let ix = Math.max(0, Math.floor(cx - ax)); ix <= Math.min(cols - 1, Math.ceil(cx + ax)); ix++) {
        const u = (ix + .5 - cx) / ax, v = (iy + .5 - cy) / ay;
        if (u * u + v * v <= 1) ctx.fillRect(ix, iy, 1, 1);
      }
    }
  }
  // Pixel pools deform along their velocity vector without drawing a
  // permanent line to their origin. All lobes use the same 4px cell renderer.
  function drawMagneticPool(x,y,vx,vy,r,color,opacity=1) {
    const speed=Math.hypot(vx,vy);
    const ux=speed>1?vx/speed:1, uy=speed>1?vy/speed:0;
    const stretch=Math.min(1, speed/550);
    const radius=r*Math.max(0,opacity);
    const reach=radius*(.08+.62*stretch);
    dot(x-ux*reach*.58,y-uy*reach*.58,
      radius*(.9+.08*stretch),radius*(.9+.08*stretch),color);
    dot(x,y,radius*(1-.10*stretch),radius*(1-.10*stretch),color);
    dot(x+ux*reach*.72,y+uy*reach*.72,
      radius*(.82+.06*stretch),radius*(.82+.06*stretch),color);
    if(stretch>.45) {
      dot(x+ux*reach*1.26,y+uy*reach*1.26,
        radius*.51,radius*.51,color);
    }
  }
  function renderDroplets(dt, time) {
    for (let i = droplets.length - 1; i >= 0; i--) {
      const d = droplets[i];
      const age = time - d.born;
      if (age < 0) continue;
      if (age >= d.lifetime) { droplets.splice(i, 1); continue; }
      if (d.attached && age < .16 && pointer) {
        // A short elastic pull follows the actual cursor. Cap its reach so
        // ultra-fast flicks release the blob instead of drawing long strings.
        const dx = pointer.x - d.ax, dy = pointer.y - d.ay;
        const dist = Math.hypot(dx, dy) || 1;
        const pull = Math.min(dist, 48);
        const targetX = d.ax + dx / dist * pull;
        const targetY = d.ay + dy / dist * pull;
        const strength = Math.min(1, dt * 28);
        d.x += (targetX - d.x) * strength;
        d.y += (targetY - d.y) * strength;
        if (dist > 65) d.attached = false;
      } else {
        d.attached = false;
      }
      if (!d.attached) {
        // Quick release and a modest float; no slow, syrup-like trailing.
        const damping = Math.exp(-dt * 4.3);
        d.vx *= damping;
        d.vy = d.vy * damping + 35 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
      }
      const shrink = age > d.lifetime * .62 ?
        clamp((d.lifetime - age) / (d.lifetime * .38), .06, 1) : 1;
      if (d.tether && age < .185) {
        const amount = 1 - age / .185;
        const n = 7;
        for (let j = 1; j < n; j++) {
          const f = j / n;
          const neck = Math.max(2.5, d.r * (1 - f * .65) * amount);
          dot(d.ax + (d.x - d.ax) * f, d.ay + (d.y - d.ay) * f,
            neck, neck, d.color);
        }
      }
      dot(d.x, d.y, d.r * shrink, d.r * .98 * shrink, d.color);
    }
  }
  function updatePortrait(dt) {
    if (!portrait) return;
    const p = portraitMotion;
    for (const [key, vel, target] of [
      ['x', 'vx', 'tx'], ['y', 'vy', 'ty'],
      ['angle', 'va', 'ta'], ['scale', 'vs', 'ts']
    ]) {
      p[vel] += ((p[target] - p[key]) * 155 - p[vel] * 17) * dt;
      p[key] += p[vel] * dt;
    }
    portrait.style.transform = `translate3d(${p.x.toFixed(2)}px,${p.y.toFixed(2)}px,0) rotate(${p.angle.toFixed(2)}deg) scale(${p.scale.toFixed(3)})`;
  }

  function draw(now) {
    raf = 0;
    const time = now / 1000;
    const dt = Math.min(.034, (now - (lastFrame || now - 16.667)) / 1000);
    lastFrame = now;
    clock = time;
    if (time >= entranceStart + .15) emitEntranceSplash(time);
    if (reduced.matches) {
      expansion = Number(open);
      expansionSpeed = 0;
      waves.length = 0;
      droplets.length = 0;
      if (portrait) portrait.style.transform = '';
    } else {
      // Spring state evolves independent of pointer event frequency.
      const steps = 2;
      for (let i = 0; i < steps; i++) {
        const h = dt / steps;
        expansionSpeed += ((Number(open) - expansion) * 94 - expansionSpeed * 15) * h;
        expansion += expansionSpeed * h;
      }
      expansion = clamp(expansion, -.015, 1.015);
      updatePortrait(dt);
    }
    for (let i = waves.length - 1; i >= 0; i--) {
      if (time - waves[i].start > .95) waves.splice(i, 1);
    }
    const g = geometry();
    const data = pixels.data;
    data.fill(0); // Only pixels affected by the liquid need raster work.
    commitCompletedFronts(time);
    const idleTime = time;
    // Keep the huge viewport canvas cheap to animate: only the island, its
    // rippling edge, and the 4px cells around it are calculated each frame.
    // Droplets render separately across the ENTIRE viewport-sized canvas.
    const pad = 95;
    const firstX = Math.max(0, Math.floor((-g.w/2-pad+width/2-canvasLeft)/CELL));
    const lastX = Math.min(cols-1, Math.ceil((g.w/2+pad+width/2-canvasLeft)/CELL));
    const firstY = Math.max(0, Math.floor((-g.h/2-pad+height/2-canvasTop)/CELL));
    const lastY = Math.min(rows-1, Math.ceil((g.h/2+pad+height/2-canvasTop)/CELL));
    for (let iy = firstY; iy <= lastY; iy++) {
      const y = canvasTop + (iy + .5) * CELL - height / 2;
      for (let ix = firstX; ix <= lastX; ix++) {
        const x = canvasLeft + (ix + .5) * CELL - width / 2;
        const index = iy * cols + ix;
        const ci = index * 3, di = index * 4;
        // Each color front progresses from its own origin and start time.
        // New hover events do NOT freeze old fronts or capture static colors.
        let cellColor = baseColor;
        for (const f of colorFronts) {
          const rx = x - f.x, ry = y - f.y;
          const radius = Math.max(0, time - f.start) * 355;
          const dsq = rx * rx + ry * ry;
          const inner = Math.max(0, radius - 12);
          if (dsq < inner * inner) {
            cellColor = f.color;
          } else if (dsq <= (radius + 12) * (radius + 12)) {
            // The boundary has a gently scalloped, cell-sized wave pattern.
            const wobble = 7 * Math.sin(ry * .062 - time * 3.1)
              + 4 * Math.sin(rx * .051 + time * 2.4);
            if (Math.sqrt(dsq) <= radius + wobble) cellColor = f.color;
          }
        }
        colors[ci] = cellColor[0];
        colors[ci + 1] = cellColor[1];
        colors[ci + 2] = cellColor[2];
        const sdf = distanceToIsland(x, y, g);
        // Subtle, visible, directional idle flow: two diagonal traveling
        // waves rather than near-static, non-directional edge noise.
        let displacement = reduced.matches ? 0 :
          3.25 * Math.sin(x * .021 + y * .010 - idleTime * 2.1)
          + 1.9 * Math.sin(x * .012 - y * .025 - idleTime * 1.45);
        if (!reduced.matches && Math.abs(sdf) < 72) {
          for (const wave of waves) {
            const age = time - wave.start;
            if (age < 0) continue;
            const dx = x - wave.x, dy = y - wave.y;
            const dist = Math.hypot(dx, dy);
            // Faster, tighter rings that lose energy before they become heavy.
            const band = (dist - age * 285) / 43;
            if (Math.abs(band) > 2.1) continue;
            const forward = (dx * wave.dx + dy * wave.dy) / Math.max(dist, 1);
            const bias = .65 + .35 * Math.max(-.3, forward);
            displacement += wave.power * Math.exp(-band * band * 1.6)
              * (1 - band * .29) * bias * Math.exp(-age * 2.7);
          }
        }
        data[di] = colors[ci];
        data[di + 1] = colors[ci + 1];
        data[di + 2] = colors[ci + 2];
        data[di + 3] = sdf < displacement ? 255 : 0;
      }
    }
    ctx.putImageData(pixels, 0, 0);
    if (!reduced.matches) {
      renderDroplets(dt,time);
      if(pull && pull.moved) {
        const rect=stage.getBoundingClientRect();
        const ax=pull.x-rect.left-width/2, ay=pull.y-rect.top-height/2;
        pull.fx ??= 0; pull.fy ??= 0; pull.vx ??= 0; pull.vy ??= 0;
        pull.vx+=((pull.dx-pull.fx)*130-pull.vx*17)*dt;
        pull.vy+=((pull.dy-pull.fy)*130-pull.vy*17)*dt;
        pull.fx+=pull.vx*dt; pull.fy+=pull.vy*dt;
        const bx=ax+pull.fx, by=ay+pull.fy;
        const color=rgb(currentKey);
        drawMagneticPool(bx,by,pull.vx,pull.vy,24,color);
        // Only short, temporary contact when the pool approaches a liquid edge.
        const edgeDistance=distanceToIsland(bx,by,g);
        if(edgeDistance>0 && edgeDistance<36) {
          const gradX=distanceToIsland(bx+4,by,g)-distanceToIsland(bx-4,by,g);
          const gradY=distanceToIsland(bx,by+4,g)-distanceToIsland(bx,by-4,g);
          const norm=Math.hypot(gradX,gradY)||1;
          const nx=gradX/norm, ny=gradY/norm;
          const gap=Math.max(0,edgeDistance-24);
          if(gap<12) {
            const bridgeX=bx-nx*(23+gap*.40), bridgeY=by-ny*(23+gap*.40);
            const contact=1-gap/12;
            dot(bridgeX,bridgeY,6+8*contact,6+8*contact,color);
          }
        }
        const velocity=Math.hypot(pull.vx,pull.vy);
        if(velocity>240 && time-(pull.lastFleck||0)>.075) {
          pull.lastFleck=time;
          const norm=velocity||1;
          droplets.push({ax:bx,ay:by,x:bx,y:by,
            vx:-pull.vx/norm*(32+Math.random()*80)+pull.vy/norm*18,
            vy:-pull.vy/norm*(32+Math.random()*80)-pull.vx/norm*18,
            r:3+Math.random()*3,born:time,lifetime:.3+Math.random()*.18,
            color:[...color],tether:false,attached:false});
          if(droplets.length>50) droplets.shift();
        }
      }
      if(returningBlob) {
        const b=returningBlob;
        b.age+=dt;
        const steps=2;
        for(let i=0;i<steps;i++) {
          const h=dt/steps;
          b.vx+=(-b.x*108-b.vx*13)*h;
          b.vy+=(-b.y*108-b.vy*13)*h;
          b.x+=b.vx*h; b.y+=b.vy*h;
        }
        const bx=b.ax+b.x, by=b.ay+b.y;
        const edgeDistance=distanceToIsland(bx,by,g);
        if((edgeDistance < b.r*.72 || b.age>.9) && !b.merged) {
          b.merged=true;
          b.merge=0;
          poolBurst(bx,by,b.color,time,1.25);
        }
        if(b.merged) b.merge=Math.min(1,b.merge+dt/.25);
        const radiusScale=b.merged ? (1-b.merge*.93) : 1;
        drawMagneticPool(bx,by,b.vx,b.vy,b.r,b.color,radiusScale);
        if(b.merged && b.merge<.92 && edgeDistance>0 && edgeDistance<36) {
          const x=b.ax+b.x*.55, y=b.ay+b.y*.55;
          dot(x,y,9*(1-b.merge),9*(1-b.merge),b.color);
        }
        if((b.merged && b.merge>=1) || b.age>1.35)
          returningBlob=null;
      }
    }
    if (!reduced.matches || colorFronts.length || Math.abs(expansion - Number(open)) > .01) requestFrame();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else { lastFrame = 0; requestFrame(); }
  });
  reduced.addEventListener('change', requestFrame);
  new ResizeObserver(resize).observe(stage);
  // Subpages animate their whole island into place. Their initial bounding
  // rect is transformed, so resync the document-wide canvas after landing.
  stage.addEventListener('animationend', e => {
    if (e.target === stage) resize();
  });
  window.addEventListener('resize', resize, {passive:true});
  resize();
  revealHeading(150); // Title enters on page load, also letter by letter.
})();
