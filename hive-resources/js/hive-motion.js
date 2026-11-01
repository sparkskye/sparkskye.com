// Hive visual motion follows the Sparkskye gallery design system.
// This file never touches resource APIs, modal content, or 3D renderer state.
(() => {
  if (!document.body.classList.contains('hive-polished')) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Only the short page title gets an entrance animation per letter.
  // No hover styling is ever attached to a page heading.
  const heading = document.querySelector('.hero__title');
  if (heading && !reduced) {
    const source = heading.textContent;
    const frag = document.createDocumentFragment();
    let charIndex = 0;
    for (const char of source) {
      if (/\s/.test(char)) {
        frag.appendChild(document.createTextNode(char));
        continue;
      }
      const span = document.createElement('span');
      span.className = 'hive-heading-character';
      span.style.setProperty('--hive-load-delay',
        (70 + Math.min(charIndex++, 25) * 28) + 'ms');
      span.textContent = char;
      frag.appendChild(span);
    }
    heading.replaceChildren(frag);
  }

  // Hover-only letter motion: no load animation and no keyframe to cancel.
  // CSS transitions return each character smoothly from any intermediate point.
  const hoverSelectors = '.topnav__btn,.topnav__dropitem,.hero__quicklinks a,' +
    '.hero__downloads a,.chip,.btn,.contrib__name,.brand__name';
  const decorated = new WeakSet();
  function decorateHover(el) {
    if (!el || decorated.has(el) || reduced) return;
    decorated.add(el);
    const textNodes = [...el.childNodes].filter(n =>
      n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (!textNodes.length) return;
    el.classList.add('hive-hover-word');
    let index = 0;
    for (const node of textNodes) {
      const fragment = document.createDocumentFragment();
      for (const character of [...node.textContent]) {
        if (/\s/.test(character)) {
          fragment.appendChild(document.createTextNode(character));
        } else {
          const span = document.createElement('span');
          span.className = 'hive-hover-character';
          span.style.setProperty('--hive-hover-delay',
            (Math.min(index++, 18) * 13) + 'ms');
          span.textContent = character;
          fragment.appendChild(span);
        }
      }
      node.replaceWith(fragment);
    }
  }
  function attachHover(root) {
    if (!root) return;
    if (root.matches?.(hoverSelectors)) decorateHover(root);
    root.querySelectorAll?.(hoverSelectors).forEach(decorateHover);
  }
  attachHover(document.body);

  // One-time entrances for prose, whole panels, contributor cards, and cards.
  // Individual filter tags intentionally do not have load bounces.
  const visible = new WeakSet();
  const entryObserver = !reduced && typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-visible');
          entryObserver.unobserve(entry.target);
        }
      }, {threshold:.06, rootMargin:'0px 0px 90px 0px'})
    : null;
  function reveal(el, index = 0) {
    if (!el || visible.has(el)) return;
    visible.add(el);
    if (reduced || !entryObserver) return;
    el.style.setProperty('--hive-reveal-delay', Math.min(index, 6) * 52 + 'ms');
    el.classList.add('hive-reveal');
    entryObserver.observe(el);
  }
  const staticBlocks = document.querySelectorAll(
    '.hero__sub,.hero__quicklinks,.hero__downloads,.panel,.contrib,.latest,.footer');
  staticBlocks.forEach((el, index) => reveal(el, index));

  const grid = document.querySelector('#grid');
  function attachCards() {
    if (!grid) return;
    [...grid.children].forEach((el, index) => {
      if (!el.classList.contains('card')) return;
      reveal(el, Math.min(index % 6, 5));
    });
  }
  if (grid) {
    // Direct additions only. Changes inside model viewers are ignored.
    new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes].some(node =>
        node.nodeType === Node.ELEMENT_NODE && node.classList.contains('card')))) {
        attachCards();
      }
    }).observe(grid, {childList:true});
    attachCards();
  }

  // Filter scripts rebuild the chip rows; decorate only newly inserted chips.
  // Never observe descendants, since letter spans are inserted inside chips.
  for (const id of ['gameChips','folderChips','modeChips']) {
    const root = document.getElementById(id);
    if (!root) continue;
    new MutationObserver(records => {
      for (const record of records) {
        for (const added of record.addedNodes) {
          if (added.nodeType === Node.ELEMENT_NODE) attachHover(added);
        }
      }
    }).observe(root, {childList:true});
    attachHover(root);
  }

  // Small pointer-reactive card motion; released cards spring back through CSS.
  if (grid && !reduced) {
    let activeCard = null;
    const resetCard = card => {
      if (!card) return;
      card.style.setProperty('--hive-px','0px');
      card.style.setProperty('--hive-py','0px');
      card.style.setProperty('--hive-rx','0deg');
      card.style.setProperty('--hive-ry','0deg');
    };
    grid.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse' || !(e.target instanceof Element)) return;
      const card = e.target.closest('.card');
      if (card !== activeCard) {
        resetCard(activeCard);
        activeCard = card;
      }
      if (!card || !card.classList.contains('is-visible')) return;
      const bounds = card.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const x = (e.clientX - bounds.left)/bounds.width - .5;
      const y = (e.clientY - bounds.top)/bounds.height - .5;
      card.style.setProperty('--hive-px', (x*5).toFixed(1)+'px');
      card.style.setProperty('--hive-py', (y*4).toFixed(1)+'px');
      card.style.setProperty('--hive-rx', (-y*1.8).toFixed(2)+'deg');
      card.style.setProperty('--hive-ry', (x*1.8).toFixed(2)+'deg');
    }, {passive:true});
    grid.addEventListener('pointerleave', () => {
      resetCard(activeCard);
      activeCard = null;
    });
    grid.addEventListener('pointerout', e => {
      const leaving = e.target instanceof Element
        ? e.target.closest('.card') : null;
      if (leaving && !leaving.contains(e.relatedTarget)) {
        resetCard(leaving);
        if (activeCard === leaving) activeCard = null;
      }
    });
  }
})();
