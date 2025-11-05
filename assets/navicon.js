(function(){
  'use strict';

  // --- Moodle env ---
  var WWWROOT = (window.M && M.cfg && M.cfg.wwwroot) || '';
  var SESSKEY = (window.M && M.cfg && M.cfg.sesskey) || '';
  var svgURL  = WWWROOT + '/local/buscador/svg/search.svg';

  // --- Cache buster / versión ---
  // Cambia LB_VER cuando subas assets nuevos (forzará recarga del CSS/JS/HTML del modal)
  var LB_VER = 'v2025-11-02-fix';
  // Añadimos un sufijo aleatorio para romper caché agresiva de proxies/CDN cuando se abra el modal
  var BUST = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
  var QV   = encodeURIComponent(LB_VER + '-' + BUST);

  // --- Rutas de recursos del modal (con versión y bust) ---
  var EMBED_URL   = WWWROOT + '/local/buscador/embed.php?format=fragment&sesskey=' + encodeURIComponent(SESSKEY) + '&v=' + QV;
  var CSS_URL     = WWWROOT + '/local/buscador/assets/buscador.css?v=' + QV;
  var ANIMATE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css';
  var JS_URL      = WWWROOT + '/local/buscador/assets/buscador.js?v=' + QV;

  // --- Utils ---
  function ready(fn){
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }
  function clearChildren(el){ while (el && el.firstChild) el.removeChild(el.firstChild); }
  function parseSVG(text){
    var doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    var svg = doc.documentElement;
    if (!svg || String(svg.nodeName).toLowerCase() !== 'svg') return null;
    svg.classList.add('lb-ico');
    svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.setAttribute('focusable','false'); svg.setAttribute('aria-hidden','true');
    return svg;
  }

  function ensureCSS(href, id){
    var el = document.getElementById(id);
    if (el && el.getAttribute('href') && el.getAttribute('href').indexOf(href.split('?')[0]) === 0) return Promise.resolve();
    if (el) try{ el.remove(); }catch(e){}
    return new Promise(function(res){
      var link = document.createElement('link');
      link.id = id; link.rel = 'stylesheet'; link.href = href;
      link.onload = function(){ res(); }; link.onerror = function(){ res(); };
      document.head.appendChild(link);
    });
  }
  function ensureJS(src, id){
    var s = document.getElementById(id);
    if (s && s.getAttribute('src') && s.getAttribute('src').indexOf(src.split('?')[0]) === 0) return Promise.resolve();
    if (s) try{ s.remove(); }catch(e){}
    return new Promise(function(res){
      var sc = document.createElement('script');
      sc.id = id; sc.src = src; sc.defer = true;
      sc.onload = function(){ res(); }; sc.onerror = function(){ res(); };
      document.head.appendChild(sc);
    });
  }

  var actListenerAttached = false;

  // Limpia estado global (evento + localStorage)
  function wipeStateGlobal(){
    try {
      if (window.LocalBuscador && typeof window.LocalBuscador.resetAll === 'function') {
        window.LocalBuscador.resetAll();
      } else {
        window.dispatchEvent(new Event('lb:resetAll'));
      }
    } catch(e){}
    try {
      ['lb:selectedcourses','lb:activecourse','lb:selectedtypes'].forEach(function(k){
        localStorage.removeItem(k);
      });
    } catch(e){}
  }

  // En caso de que el HTML llegue antes que el JS de la UI, limpiamos inputs/filtros
  function forceUICleanUntilReady(){
    var tries = 0;
    var iv = setInterval(function(){
      tries++;
      var root = document.getElementById('lb-root');
      if (!root){ clearInterval(iv); return; }

      var inp = document.getElementById('lb-input');
      if (inp){ inp.value = ''; inp.dispatchEvent(new Event('input', {bubbles:true})); }

      var msClear = document.getElementById('ms-clear');
      var mtClear = document.getElementById('mt-clear');
      if (msClear) msClear.click();
      if (mtClear) mtClear.click();

      document.querySelectorAll('#ms-list input[type="checkbox"]:checked').forEach(function(chk){
        chk.checked = false; chk.dispatchEvent(new Event('change', {bubbles:true}));
      });
      document.querySelectorAll('#mt-list input[type="checkbox"]:checked').forEach(function(chk){
        chk.checked = false; chk.dispatchEvent(new Event('change', {bubbles:true}));
      });

      if (msClear && mtClear){ clearInterval(iv); return; }
      if (tries > 30){ clearInterval(iv); }
    }, 100);
  }

  function openModal(){
    if (document.getElementById('lb-root')) return;

    // Limpia estado previo y (muy importante) fuerza a bajar versiones nuevas de assets
    wipeStateGlobal();

    return Promise.all([
      ensureCSS(ANIMATE_URL, 'lb-animate-css'),
      ensureCSS(CSS_URL,     'lb-css'),
      ensureJS(JS_URL,       'lb-js')
    ])
    .then(function(){
      wipeStateGlobal();
      return fetch(EMBED_URL, {credentials:'same-origin'}).then(function(r){
        if(!r.ok) throw new Error('HTTP '+r.status);
        return r.text();
      });
    })
    .then(function(html){
      var wrap = document.createElement('div');
      wrap.innerHTML = (html||'').trim();
      var node = wrap.firstElementChild;
      if(!node) return;

      document.body.appendChild(node);

      try{
        node.style.setProperty('--glass-tint','0');
        node.style.setProperty('--glass-dim','0');
      }catch(e){}

      document.body.classList.add('lb-noscroll');

      try {
        wipeStateGlobal();
        if (window.LocalBuscadorInit) window.LocalBuscadorInit();
        document.dispatchEvent(new Event('DOMContentLoaded'));
        document.dispatchEvent(new CustomEvent('lb:boot'));
      } catch(e){}
      forceUICleanUntilReady();

      function safeClose(ev){
        if (ev){ ev.preventDefault(); ev.stopImmediatePropagation(); }
        wipeStateGlobal();
        var root = document.getElementById('lb-root');
        if (root) root.remove();
        document.body.classList.remove('lb-noscroll');
      }
      var btn = document.getElementById('lb-close');
      if (btn) btn.addEventListener('click', safeClose, true);
      document.addEventListener('keydown', function(e){
        if (e.key === 'Escape' && document.getElementById('lb-root')) safeClose(e);
      }, true);

      if (!actListenerAttached){
        document.addEventListener('click', function(e){
          var a = e.target && e.target.closest ? e.target.closest('a.lb-act-link') : null;
          if (a && document.getElementById('lb-root')) {
            wipeStateGlobal();
          }
        }, true);
        actListenerAttached = true;
      }
    })
    .catch(function(){ /* silencio */ });
  }

  function injectIconAndHook(link, svgNode){
    if (!link) return;

    if (svgNode && !link.dataset.lbSvgInjected){
      link.setAttribute('aria-label','Buscador');
      link.title = 'Buscador';
      clearChildren(link);
      link.classList.add('lb-onlyicon');
      link.appendChild(svgNode.cloneNode(true));
      link.dataset.lbSvgInjected = '1';
    }

    if (!link.dataset.lbHooked){
      link.addEventListener('click', function(e){
        e.preventDefault();
        openModal();
      });
      link.dataset.lbHooked = '1';
    }
  }

  function mountOnce(svgText){
    var svgNode = parseSVG(svgText);
    var sel = 'a[href*="/local/buscador/view.php"]';
    document.querySelectorAll(sel).forEach(function(a){ injectIconAndHook(a, svgNode); });

    var mo = new MutationObserver(function(){
      document.querySelectorAll(sel).forEach(function(a){ injectIconAndHook(a, svgNode); });
    });
    mo.observe(document.body, { childList:true, subtree:true });
  }

  function mount(){
    fetch(svgURL, { credentials:'same-origin' })
      .then(function(r){ if(!r.ok) throw new Error(r.statusText); return r.text(); })
      .then(mountOnce)
      .catch(function(){
        var sel = 'a[href*="/local/buscador/view.php"]';
        document.querySelectorAll(sel).forEach(function(a){ injectIconAndHook(a, null); });
      });
  }

  ready(mount);

  window.LocalBuscador = Object.assign(window.LocalBuscador || {}, { open: openModal });

})();
