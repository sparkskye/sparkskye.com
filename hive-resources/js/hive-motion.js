
// Hive visual motion runs independently from Maps/Models API and 3D viewer logic.
(() => {
  if (!document.body.classList.contains('hive-polished')) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const letterTargets = '.hero__title,.hero__sub,.panel__label,.topnav__btn,'+
    '.topnav__dropitem,.chip,.btn,.card__name a,.card__name:not(:has(a)),'+
    '.contrib__name,.hero__quicklinks a';
  function decorate(el) {
    if (!el || el.dataset.hiveLetters === 'true') return;
    const nodes = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
    if (!nodes.length) return;
    el.dataset.hiveLetters = 'true';
    el.classList.add('hive-letter-parent');
    let i = 0;
    for (const node of nodes) {
      const frag = document.createDocumentFragment();
      for (const char of [...node.textContent]) {
        if (/\s/.test(char)) {
          frag.appendChild(document.createTextNode(char));
        } else {
          const span = document.createElement('span');
          span.className = 'hive-letter';
          span.style.setProperty('--hive-i', String(i));
          span.style.setProperty('--hive-intro-delay', Math.min(i,32)*28+'ms');
          span.style.setProperty('--hive-label-delay', Math.min(i,22)*18+'ms');
          span.style.setProperty('--hive-hover-delay', Math.min(i,30)*17+'ms');
          i++;
          span.textContent = char;
          frag.appendChild(span);
        }
      }
      node.replaceWith(frag);
    }
  }
  const decorateRoot = root => {
    if (!root) return;
    if (root.matches?.(letterTargets)) decorate(root);
    root.querySelectorAll?.(letterTargets).forEach(decorate);
  };
  decorateRoot(document.body);

  const order = (selector, root=document) => {
    [...root.querySelectorAll(selector)].forEach((el,i)=>{
      if (el.dataset.hiveChipAnimated) return;
      el.dataset.hiveChipAnimated='true';
      el.style.setProperty('--hive-order',i);
      el.style.setProperty('--hive-order-delay',Math.min(i,12)*46+'ms');
      if (!reduced.matches) el.classList.add('hive-chip-entrance');
    });
  };
  order('.topnav__btn,.contrib');
  const dynamicRoots = ['#gameChips','#folderChips','#modeChips','#grid'];
  for (const selector of dynamicRoots) {
    const root = document.querySelector(selector);
    if (!root) continue;
    // Observe ONLY direct child additions. Wrapping letters inside a button
    // does not trigger this observer and cannot create a mutation feedback loop.
    const refresh = () => {
      decorateRoot(root);
      if (selector !== '#grid') order('.chip',root);
    };
    new MutationObserver(refresh).observe(root,{childList:true});
    refresh();
  }

  // Hover ripples use one parent class, never an animation per pointermove.
  document.addEventListener('pointerover',e=>{
    if (e.pointerType === 'touch' || !(e.target instanceof Element)) return;
    const el=e.target.closest('.hive-letter-parent');
    if (!el || el.contains(e.relatedTarget)) return;
    el.classList.add('hive-hovering');
  });
  document.addEventListener('pointerout',e=>{
    if (e.pointerType === 'touch' || !(e.target instanceof Element)) return;
    const el=e.target.closest('.hive-letter-parent');
    if (!el || el.contains(e.relatedTarget)) return;
    el.classList.remove('hive-hovering');
  });

  const touched = new Map();
  document.addEventListener('pointerdown',e=>{
    if (e.pointerType!=='touch' || !(e.target instanceof Element)) return;
    const el=e.target.closest('.hive-letter-parent');
    if (el) touched.set(e.pointerId, {el,x:e.clientX,y:e.clientY});
  },true);
  document.addEventListener('pointerup',e=>{
    const touch=touched.get(e.pointerId);
    touched.delete(e.pointerId);
    if (!touch || Math.hypot(e.clientX-touch.x,e.clientY-touch.y)>15) return;
    // Native click is left unmodified; only the original control animates.
    const el=touch.el;
    if (!el.isConnected || reduced.matches) return;
    el.classList.remove('hive-touch-letters');
    void el.offsetWidth;
    el.classList.add('hive-touch-letters');
    setTimeout(()=>el.classList.remove('hive-touch-letters'),800);
  },true);
  document.addEventListener('pointercancel',e=>touched.delete(e.pointerId),true);

  const grid=document.querySelector('#grid');
  if (grid && !reduced.matches) {
    let hovered=null;
    const reset=card=>{
      if (!card) return;
      card.style.setProperty('--hive-px','0px');
      card.style.setProperty('--hive-py','0px');
      card.style.setProperty('--hive-rx','0deg');
      card.style.setProperty('--hive-ry','0deg');
    };
    grid.addEventListener('pointermove',e=>{
      if (e.pointerType !== 'mouse' || !(e.target instanceof Element)) return;
      const card=e.target.closest('.card');
      if (card===hovered && !card) return;
      if (card !== hovered) {reset(hovered);hovered=card;}
      if (!card || !card.classList.contains('is-visible')) return;
      const rect=card.getBoundingClientRect();
      const x=(e.clientX-rect.left)/rect.width-.5;
      const y=(e.clientY-rect.top)/rect.height-.5;
      card.style.setProperty('--hive-px', (x*6).toFixed(1)+'px');
      card.style.setProperty('--hive-py', (y*5).toFixed(1)+'px');
      card.style.setProperty('--hive-rx', (-y*2).toFixed(2)+'deg');
      card.style.setProperty('--hive-ry', (x*2).toFixed(2)+'deg');
    },{passive:true});
    grid.addEventListener('pointerout',e=>{
      if (e.target instanceof Element && e.target.closest('.card') &&
        !e.target.closest('.card').contains(e.relatedTarget)){
        reset(e.target.closest('.card'));
        hovered=null;
      }
    });
  }
})();
