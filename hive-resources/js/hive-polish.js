
// Progressive enhancements for Hive Resources. Does not replace data, downloads,
// navigation, map gestures or model-viewer controls.
(() => {
  const body = document.body;
  if (!body.classList.contains('hive-polished')) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const gallery = body.classList.contains('hive-gallery');
  const modal = document.querySelector('#modal');
  const viewer = document.querySelector('#modalViewer');

  if (!gallery) return;
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
  // Match creation-gallery exit motion without changing the original
  // Maps/Models closeModal functions, URL restoration, or preview disposal.
  let closing = false, completeClose = false;
  const closeButton = document.getElementById('modalClose');
  const backdrop = document.getElementById('modalBackdrop');
  const visuallyClose = event => {
    if (!modal.classList.contains('is-open') || completeClose) return;
    if (modal.classList.contains('hive-fullscreen')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleFullscreen();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (closing) return;
    closing = true;
    modal.classList.add('hive-is-closing');
    setTimeout(() => {
      closing = false;
      modal.classList.remove('hive-is-closing');
      if (!modal.classList.contains('is-open')) return;
      completeClose = true;
      // Call the existing close handler so all state and URLs are restored.
      closeButton?.click();
      completeClose = false;
    }, reduce.matches ? 0 : 260);
  };
  document.addEventListener('click', e => {
    if (closeButton?.contains(e.target) || backdrop?.contains(e.target)) {
      visuallyClose(e);
    }
  }, true);
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !modal.classList.contains('is-open')) return;
    if (modal.classList.contains('hive-fullscreen')) {
      e.stopImmediatePropagation();
      e.preventDefault();
      toggleFullscreen();
      return;
    }
    visuallyClose(e);
  }, true);
  // Native scroll remains locked by the existing modal. The document gutter
  // is reserved by CSS, preventing a sudden horizontal shift.
})();
