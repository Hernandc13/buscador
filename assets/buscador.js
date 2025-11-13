/* local/buscador/assets/buscador.js */
(function(){
  'use strict';

  const byId = id => document.getElementById(id);
  const qs   = (s,r)=> (r||document).querySelector(s);
  const esc  = s => String(s ?? '').replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

  const debounce = (fn, ms)=>{
    let t;
    function d(...a){ clearTimeout(t); t = setTimeout(()=>fn(...a), ms); }
    d.cancel = ()=> clearTimeout(t);
    return d;
  };

  const RESET_ON_OPEN = true;
  const fold = s => (String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase());
  const HIDE_TYPES = new Set(['qbank']);

  const LS = { selected:'lb:selectedcourses', active:'lb:activecourse', selectedTypes:'lb:selectedtypes' };
  const st = {
    endpoint:'', sesskey:'', wwwroot:'',
    icons:{}, strings:{},
    selected:new Set(), active:0, activeName:'',
    q:'', mode:'course',
    cacheCourses:new Map(),
    typesCatalog:[], typesSelected:new Set(),
    svg:{down:'', up:''}
  };

  const DEFAULT_TYPES = [
    ['assign','Tarea'],['attendance','Asistencia'],['book','Libro'],['choice','Elección'],
    ['data','Base de datos'],['feedback','Retroalimentación'],['folder','Carpeta'],
    ['forum','Foro'],['glossary','Glosario'],['h5pactivity','Interactivas'],['imscp','Paquete IMS'],
    ['label','Etiqueta'],['lesson','Lección'],['lti','LTI'],['page','Página'],['quiz','Examen'],
    ['resource','Documentos'],['scorm','SCORM'],['survey','Encuesta'],['url','Enlace'],
    ['wiki','Resumen'],['workshop','Taller'],['edwiservideoactivity','Videos'],['imgviewer','Flashcards']
  ].map(([modname,label])=>({modname,label})).filter(t=>!HIDE_TYPES.has(t.modname));

  /* =================== API =================== */
  function api(url){
    const u = url + (url.includes('?')?'&':'?') + 'sesskey='+encodeURIComponent(st.sesskey);
    return fetch(u, {credentials:'same-origin', headers:{'Accept':'application/json'}})
      .then(r=> r.ok ? r.json() : Promise.reject(new Error('HTTP '+r.status)));
  }
  function listCourses(q,page=1,limit=300){
    const key = `${q}|${page}|${limit}`;
    if (st.cacheCourses.has(key)) return Promise.resolve(st.cacheCourses.get(key));
    return api(`${st.endpoint}?action=courses&q=${encodeURIComponent(q||'')}&page=${page}&limit=${limit}`)
      .then(d=>{ st.cacheCourses.set(key,d); return d; });
  }
  function listActivities(courseid,q,typesCSV){
    const t  = typesCSV ? `&types=${encodeURIComponent(typesCSV)}` : '';
    const qq = q ? `&q=${encodeURIComponent(q)}` : '';
    return api(`${st.endpoint}?action=activities&courseid=${courseid}${qq}${t}`);
  }
  function searchAll(q,limit,typesCSV,coursesCSV){
    const t = typesCSV ? `&types=${encodeURIComponent(typesCSV)}` : '';
    const c = coursesCSV ? `&courses=${encodeURIComponent(coursesCSV)}` : '';
    return api(`${st.endpoint}?action=search&q=${encodeURIComponent(q||'')}&limit=${limit||200}${t}${c}`);
  }
  function listTypes(){ return api(`${st.endpoint}?action=types`); }
  function listFolderFiles(cmid){ return api(`${st.endpoint}?action=folderfiles&cmid=${encodeURIComponent(cmid)}`); }

  function saveSelected(){
    localStorage.setItem(LS.selected, JSON.stringify(Array.from(st.selected)));
    localStorage.setItem(LS.active, String(st.active||0));
  }
  function restoreSelected(){
    try{
      (JSON.parse(localStorage.getItem(LS.selected)||'[]')||[]).forEach(id=> st.selected.add(parseInt(id,10)));
      st.active = parseInt(localStorage.getItem(LS.active)||'0',10) || 0;
    }catch(e){}
  }
  function saveSelectedTypes(){
    localStorage.setItem(LS.selectedTypes, JSON.stringify(Array.from(st.typesSelected)));
  }
  function restoreSelectedTypes(){
    try{
      (JSON.parse(localStorage.getItem(LS.selectedTypes)||'[]')||[]).forEach(m=> st.typesSelected.add(String(m)));
    }catch(e){}
  }

  /* =================== contadores =================== */
  function updateCourseCount(){
    const c = st.selected.size;
    const el = byId('ms-count');
    if (el) el.textContent = c ? `${c} seleccionado${c>1?'s':''}` : 'Todos';
  }
  function updateTypeCount(){
    const c = st.typesSelected.size;
    const el = byId('mt-count');
    if (el) el.textContent = c ? `${c} seleccionado${c>1?'s':''}` : 'Todos';
  }

  /* =================== reset total =================== */
  function resetAllFilters(){
    st.selected.clear();
    st.typesSelected.clear();
    st.active = 0;
    st.activeName = '';
    st.q = '';
    st.mode = 'course';

    try { runSearch.cancel && runSearch.cancel(); } catch(e){}

    try{
      localStorage.removeItem(LS.selected);
      localStorage.removeItem(LS.active);
      localStorage.removeItem(LS.selectedTypes);
    }catch(e){}

    const input = byId('lb-input'); if (input) input.value='';
    const msInput = byId('ms-input'); if (msInput) msInput.value='';
    const mtInput = byId('mt-input'); if (mtInput) mtInput.value='';

    const msCount = byId('ms-count'); if (msCount) msCount.textContent='Todos';
    const mtCount = byId('mt-count'); if (mtCount) mtCount.textContent='Todos';

    const results = byId('lb-results'); if (results){ results.innerHTML=''; results.setAttribute('hidden',''); }
    const view    = byId('lb-courseview'); if (view) view.innerHTML='';
    const empty   = byId('lb-empty'); if (empty) empty.removeAttribute('hidden');

    const tabs = byId('lb-course-tabs-global') || byId('lb-course-tabs-top');
    if (tabs){ tabs.innerHTML=''; tabs.setAttribute('hidden',''); }

    byId('ms-panel')?.setAttribute('hidden','');
    byId('mt-panel')?.setAttribute('hidden','');
    byId('ms-trigger')?.classList.remove('is-open');
    byId('mt-trigger')?.classList.remove('is-open');
  }
  window.LocalBuscador = Object.assign(window.LocalBuscador || {}, { resetAll: resetAllFilters });
  window.addEventListener('lb:resetAll', function(){ try { resetAllFilters(); } catch(e){} });

  /* =================== items: cursos =================== */
  function renderCourseItem(c){
    const li = document.createElement('li');
    li.className='ms-item'; li.setAttribute('role','option');
    const checked = st.selected.has(c.courseid);
    li.innerHTML = `
      <label class="ms-check">
        <input type="checkbox" value="${c.courseid}" ${checked?'checked':''}>
        <span class="ms-texts">
          <span class="ms-title" title="${esc(c.coursename)}">${esc(c.coursename)}</span>
          ${(c.shortname||c.category)?`<span class="ms-sub">${esc(c.shortname||c.category)}</span>`:''}
        </span>
      </label>`;
    li.querySelector('input').addEventListener('change', e=>{
      const id = parseInt(e.target.value,10);
      if (e.target.checked){
        st.selected.add(id); st.active=id; st.activeName=c.coursename;
      } else {
        st.selected.delete(id);
        if (st.active===id){ st.active = Array.from(st.selected)[0] || 0; }
      }
      saveSelected(); updateCourseCount(); renderTabs(); routeAfterFiltersChange();
    });
    return li;
  }
  function loadDropdownCourses(q){
    const list = byId('ms-list'); if (!list) return;
    list.innerHTML='';
    listCourses(q,1,300).then(data=>{
      (data.hits||[]).forEach(c=> list.appendChild(renderCourseItem(c)));
      updateCourseCount();
    });
  }

  /* =================== items: tipos =================== */
  function renderTypeItem(t){
    const li = document.createElement('li');
    li.className='ms-item'; li.setAttribute('role','option');
    const checked = st.typesSelected.has(t.modname);
    li.innerHTML = `
      <label class="ms-check">
        <input type="checkbox" value="${t.modname}" ${checked?'checked':''}>
        <span class="ms-texts">
          <span class="ms-title">${esc(t.label)}</span>
        </span>
      </label>`;
    li.querySelector('input').addEventListener('change', e=>{
      const val = String(e.target.value||'');
      if (e.target.checked){ st.typesSelected.add(val); }
      else { st.typesSelected.delete(val); }
      saveSelectedTypes(); updateTypeCount();

      const hasShortQuery = (st.q||'').trim().length < 2;
      if (st.active && hasShortQuery){
        showActiveCourse(); 
      } else {
        runSearch();  
      }
    });
    return li;
  }
  function loadDropdownTypes(q){
    const list = byId('mt-list'); if (!list) return;
    list.innerHTML='';
    const term = fold((q||'').trim());
    const pool = st.typesCatalog.filter(t=> !HIDE_TYPES.has(t.modname));
    const items = term
      ? pool.filter(t => fold(t.label).includes(term) || fold(t.modname).includes(term))
      : pool.slice();
    if (!items.length){
      const li = document.createElement('li');
      li.className='ms-item';
      li.innerHTML = `<div class="ms-check" style="opacity:.7;cursor:default;">(sin tipos)</div>`;
      list.appendChild(li);
    } else {
      items.forEach(t=> list.appendChild(renderTypeItem(t)));
    }
    updateTypeCount();
  }

  /* =================== tabs cursos =================== */
  function renderTabs(){
    const container = byId('lb-course-tabs-global');
    const rowwrap   = byId('lb-tabs-row');
    if (!container) return;
    const arr = Array.from(st.selected);
    container.innerHTML = '';
    if (!arr.length){
      container.setAttribute('hidden','');
      if (rowwrap) rowwrap.setAttribute('hidden','');
      return;
    }
    container.removeAttribute('hidden');
    if (rowwrap) rowwrap.removeAttribute('hidden');

    listCourses('',1,300).then(data=>{
      const map = new Map((data.hits||[]).map(c=>[c.courseid,c.coursename]));
      arr.forEach(id=>{
        const b = document.createElement('button');
        b.className='lb-tab lb-tab--sm'+(st.active===id?' active':'');
        const label = map.get(id)||`Curso ${id}`;
        b.textContent = label; b.title = label;
        b.addEventListener('click', ()=>{
          st.active=id; st.activeName=map.get(id)||'';
          saveSelected(); renderTabs();
          const qtxt = (st.q||'').trim();
          if (qtxt.length>=2 && st.selected.size>1) runSearch();
          else clearSearchAndShowCourse();
        });
        container.appendChild(b);
      });
    });
  }

  /* =================== archivos de folder =================== */

  // Forzar que la URL abra inline (sin descarga forzada)
  function inlineURL(url) {
    try {
      const u = new URL(url, location.origin);
      if (!u.searchParams.has('forcedownload')) {
        u.searchParams.set('forcedownload', '0');
      }
      return u.toString();
    } catch (e) {
      return url + (url.includes('?') ? '&' : '?') + 'forcedownload=0';
    }
  }

  function fileRowEl(file) {
    const row = document.createElement('div');
    row.className = 'lb-file';

    const href = inlineURL(file.url || '#');

    row.innerHTML = `
      <span class="lb-elbow" aria-hidden="true"></span>
      <div class="lb-file-icon">
        ${file.icon ? `<img class="lb-file-img" src="${esc(file.icon)}" alt="">` : ''}
      </div>
      <div class="lb-file-main">
        <a class="lb-file-link"
           href="${esc(href)}"
           target="_blank"
           rel="noopener noreferrer"
           title="${esc(file.name || 'Archivo')}">
          ${esc(file.name || 'Archivo')}
        </a>
      </div>
    `;
    return row;
  }

  function renderFiles(container, files) {
    if (!container) return;

    container.innerHTML = '';

    if (!files || !files.length) {
      container.innerHTML = `<div class="lb-subloading">(sin archivos)</div>`;
      return;
    }

    const frag = document.createDocumentFragment();
    files.forEach(f => frag.appendChild(fileRowEl(f)));
    container.appendChild(frag);
  }

  /**
   * Inserta el botón "Ver archivos" y el bloque donde se pintan
   * los archivos de la carpeta (respuesta de folderfiles).
   * El bloque se coloca DENTRO de la misma fila, ocupando toda la anchura.
   */
  function attachFolderUI(row, a) {
    const actions = row.querySelector('.lb-act-actions, .lb-res-actions');
    if (!actions) return;

    // Evitar crear dos veces el bloque en la misma fila
    if (row.dataset.hasFolderUi === '1') return;
    row.dataset.hasFolderUi = '1';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lb-btn lb-btn-mini lb-files-toggle';
    btn.textContent = 'Ver archivos';

    btn.dataset.cmid = String(a.cmid || a.id || '');
    if (a.url) {
      btn.dataset.url = a.url; // fallback: abrir carpeta normal
    }

    actions.appendChild(btn);

    // Contenedor donde aparecerán los archivos (dentro de la fila)
    const filesBlock = document.createElement('div');
    filesBlock.className = 'lb-files-inline';
    filesBlock.style.gridColumn = '1 / -1';
    filesBlock.style.display   = 'none';

    const wrap = document.createElement('div');
    wrap.className = 'lb-files-wrap';
    filesBlock.appendChild(wrap);

    row.appendChild(filesBlock);

    // Si PHP ya mandó hijos (cuando vienes de activities con query)
    const preload = Array.isArray(a.children) && a.children.length ? a.children : null;
    if (preload) {
      renderFiles(wrap, preload);
      btn.dataset.loaded = '1';
    }

    btn.addEventListener('click', () => {
      const isOpen = filesBlock.style.display !== 'none';

      if (isOpen) {
        filesBlock.style.display = 'none';
        btn.classList.remove('is-open');
        return;
      }

      filesBlock.style.display = 'block';
      btn.classList.add('is-open');

      // Ya se cargaron antes (o venían precargados)
      if (btn.dataset.loaded === '1') {
        return;
      }

      const cmid = btn.dataset.cmid;
      if (!cmid) {
        renderFiles(wrap, []);
        btn.dataset.loaded = '1';
        return;
      }

      wrap.innerHTML = `<div class="lb-subloading">Cargando…</div>`;

      listFolderFiles(cmid)
        .then(data => {
          console.log('[Buscador] folderfiles cmid=', cmid, 'respuesta=', data);
          const arr = data && Array.isArray(data.children) ? data.children : [];

          // Si no hay archivos, usamos fallback: abrir la carpeta normal
          if (!arr.length && btn.dataset.url) {
            filesBlock.style.display = 'none';
            btn.classList.remove('is-open');
            window.open(btn.dataset.url, '_blank', 'noopener');
            return;
          }

          renderFiles(wrap, arr);
          btn.dataset.loaded = '1';
        })
        .catch(err => {
          console.error('[Buscador] error folderfiles cmid=', cmid, err);
          renderFiles(wrap, []);
          btn.dataset.loaded = '1';
        });
    });
  }

  /* =================== secciones / resultados =================== */
  function pickIcon(a){ return (a && a.icon) ? a.icon : (st.icons[a?.modname] || st.icons.default || ''); }

  function renderSections(wrap, sections){
    if (!sections.length){
      wrap.innerHTML = `<div class="lb-empty">${esc(st.strings.nosections)}</div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    sections.forEach(s=>{
      const sec  = document.createElement('section');
      sec.className='lb-sec';
      const body = document.createElement('div'); body.className='lb-sec-body';

      const total    = s.total ?? (s.activities||[]).length;
      const filtered = (s.activities||[]).length;
      const countText= st.q ? `${filtered}/${total}` : `${filtered}`;

      sec.innerHTML = `
        <div class="lb-sec-head" role="button" tabindex="0" aria-expanded="true">
          <h4 class="lb-sec-title">${esc(s.name)}</h4>
          <span class="lb-count">${esc(countText)}</span>
          <button class="lb-sec-toggle" aria-label="Contraer">
            <img src="${esc(st.svg.down)}" alt="">
          </button>
        </div>`;
      (s.activities||[]).forEach(a=>{
        const row = document.createElement('div');
        row.className='lb-act';
        const src = pickIcon(a);
        row.innerHTML = `
          <div class="lb-act-icon">${src?`<img src="${esc(src)}" alt="" role="presentation" class="lb-act-img">`:''}</div>
          <div class="lb-act-main">
            <div class="lb-act-name" title="${esc(a.name)}">${esc(a.name)}</div>
            ${a.coursename?`<div class="lb-act-sub">${esc(a.coursename)}</div>`:''}
          </div>
          <div class="lb-act-actions">
            <a class="lb-btn lb-btn-mini lb-act-link" href="${esc(a.url)}" target="_blank" rel="noopener">Abrir
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor"
                   class="bi bi-arrow-up-right-circle" viewBox="0 0 16 16">
                <path fill-rule="evenodd"
                      d="M1 8a7 7 0 1 0 14 0A7 7 0 0 0 1 8m15 0A8 8 0 1 1 0 8a8 8 0 0 1 16 0M5.854 10.803a.5.5 0 1 1-.708-.707L9.243 6H6.475a.5.5 0 1 1 0-1h3.975a.5.5 0 0 1 .5.5v3.975a.5.5 0 1 1-1 0V6.707z"/>
              </svg>
            </a>
          </div>`;
        body.appendChild(row);

        if (String(a.modname||'') === 'folder' && !a.isfile){
          attachFolderUI(row, a);
        }
      });
      sec.appendChild(body);

      const head = sec.querySelector('.lb-sec-head');
      const btn  = sec.querySelector('.lb-sec-toggle');
      const open = ()=>{
        sec.classList.add('is-open');
        head.setAttribute('aria-expanded','true');
        body.style.overflow='hidden'; body.style.maxHeight='0px';
        const target = body.scrollHeight + 24;
        requestAnimationFrame(()=>{
          body.style.transition='max-height 260ms ease';
          body.style.maxHeight = target + 'px';
          setTimeout(()=>{ body.style.maxHeight='none'; body.style.overflow='visible'; body.style.transition=''; }, 280);
        });
      };
      const close = ()=>{
        head.setAttribute('aria-expanded','false');
        const h = body.scrollHeight;
        body.style.overflow='hidden'; body.style.maxHeight= h + 'px';
        requestAnimationFrame(()=>{
          body.style.transition='max-height 220ms ease';
          body.style.maxHeight='0px';
          setTimeout(()=>{ sec.classList.remove('is-open'); body.style.transition=''; }, 230);
        });
      };
      head.addEventListener('click', e=>{ e.preventDefault(); sec.classList.contains('is-open')?close():open(); });
      head.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); sec.classList.contains('is-open')?close():open(); } });
      btn.addEventListener('click', e=>{ e.preventDefault(); e.stopPropagation(); sec.classList.contains('is-open')?close():open(); });

      setTimeout(open, 10);
      frag.appendChild(sec);
    });
    wrap.innerHTML=''; wrap.appendChild(frag);
  }

  function renderResults(list){
    const results = byId('lb-results');
    const view = byId('lb-courseview');
    const empty = byId('lb-empty');

    view.innerHTML=''; empty.setAttribute('hidden',''); results.innerHTML='';

    if (!list || !list.length){
      results.innerHTML = `<div class="lb-empty">Sin resultados</div>`;
      results.removeAttribute('hidden');
      return;
    }

    const byCourse = new Map();
    list.forEach(x=>{
      const k = x.courseid+'|'+x.coursename;
      if(!byCourse.has(k)) byCourse.set(k, []);
      byCourse.get(k).push(x);
    });

    byCourse.forEach((items, key)=>{
      const [, coursename] = key.split('|');
      const card = document.createElement('section');
      card.className='lb-res';
      card.innerHTML = `<h3 class="lb-res-head">${esc(coursename)}</h3>`;

      items.forEach(a=>{
        const row = document.createElement('div');
        row.className='lb-res-item';

        const src = pickIcon(a);

        let parentLabel = '';
        let fileLabel   = a.name || '';
        if (a.isfile && typeof a.name === 'string'){
          const i = a.name.indexOf(' / ');
          if (i !== -1){
            parentLabel = a.name.slice(0, i);
            fileLabel   = a.name.slice(i + 3);
          }
        }

        const btnLabel = a.isfile ? 'Ver archivo' : 'Abrir';

        row.innerHTML = `
          <div class="lb-res-icon">
            ${src ? `<img src="${esc(src)}" alt="" role="presentation" class="lb-act-img">` : ''}
          </div>
          <div class="lb-res-main">
            ${
              a.isfile
              ? `<div class="lb-res-name lb-res-name--file" title="${esc(a.name)}">
                   <span class="lb-res-parent">${esc(parentLabel)}</span>
                   <span class="lb-res-sep">/</span>
                   <span class="lb-res-file">${esc(fileLabel)}</span>
                 </div>`
              : `<div class="lb-res-name" title="${esc(a.name)}">${esc(a.name)}</div>`
            }
          </div>
          <div class="lb-res-actions">
            <a class="lb-btn lb-btn-mini lb-act-link"
               href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${btnLabel}
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor"
                   class="bi bi-arrow-up-right-circle" viewBox="0 0 16 16">
                <path fill-rule="evenodd"
                      d="M1 8a7 7 0 1 0 14 0A7 7 0 0 0 1 8m15 0A8 8 0 1 1 0 8a8 8 0 0 1 16 0M5.854 10.803a.5.5 0 1 1-.708-.707L9.243 6H6.475a.5.5 0 1 1 0-1h3.975a.5.5 0 0 1 .5.5v3.975a.5.5 0 1 1-1 0V6.707z"/>
              </svg>
            </a>
          </div>`;

        if (String(a.modname||'') === 'folder' && !a.isfile){
          attachFolderUI(row, a);
        }

        card.appendChild(row);
      });

      results.appendChild(card);
    });

    results.removeAttribute('hidden');
  }

  /* =================== Ruteo =================== */
  function routeAfterFiltersChange(){
    const q = (st.q||'').trim();
    const hasTypes = st.typesSelected.size > 0;

    if (!st.active || st.selected.size === 0){
      if (hasTypes || q.length >= 2){ runSearch(); return; }
      const results = byId('lb-results'); const view = byId('lb-courseview'); const empty = byId('lb-empty');
      results?.setAttribute('hidden',''); if (view) view.innerHTML=''; empty?.removeAttribute('hidden'); return;
    }

    if (q.length >= 2 && st.selected.size > 1){
      runSearch();
    } else {
      showActiveCourse();
    }
  }

  /* =================== búsqueda =================== */
  const runSearch = debounce(()=>{
    const q = (st.q||'').trim();
    const results = byId('lb-results');
    const view = byId('lb-courseview');
    const loading = byId('lb-loading');
    const empty = byId('lb-empty');
    const hasTypes = st.typesSelected.size > 0;

    if (q.length < 2 && !hasTypes){
      if (st.active){
        st.mode='course'; results.setAttribute('hidden',''); showActiveCourse();
      } else {
        results?.setAttribute('hidden',''); view.innerHTML=''; empty.removeAttribute('hidden');
      }
      return;
    }

    st.mode='search';
    results.innerHTML=''; view.innerHTML=''; empty.setAttribute('hidden',''); loading.removeAttribute('hidden');
    const typesCSV   = Array.from(st.typesSelected).join(',');
    const coursesCSV = st.selected.size ? Array.from(st.selected).join(',') : '';

    if (q.length < 2 && hasTypes){
      searchAll('', 400, typesCSV, coursesCSV)
        .then(data=>{ loading.setAttribute('hidden',''); renderResults((data.results||[])); })
        .catch(()=> loading.setAttribute('hidden',''));
      return;
    }

    searchAll(q, 400, typesCSV, coursesCSV)
      .then(data=>{ loading.setAttribute('hidden',''); renderResults(data.results || []); })
      .catch(()=> loading.setAttribute('hidden',''));
  }, 260);

  function clearSearchAndShowCourse(){
    const input = byId('lb-input'); if (input){ input.value=''; }
    st.q=''; st.mode='course'; showActiveCourse();
  }

  function fetchTypesRobust(){
    return listTypes()
      .then(resp => {
        const arr  = Array.isArray(resp) ? resp : (resp?.types || []);
        const sane = Array.from(
          new Map(
            (arr || [])
              .filter(x => x && x.modname && !HIDE_TYPES.has(String(x.modname)))
              .map(x => [String(x.modname), {modname:String(x.modname), label:String(x.label||x.modname)}])
          ).values()
        );
        sane.sort((a,b)=> (a.label||'').localeCompare(b.label||'', undefined, {sensitivity:'base'}));
        return sane.length ? sane : DEFAULT_TYPES;
      })
      .catch(()=> DEFAULT_TYPES);
  }

  /* =================== curso activo =================== */
  function showActiveCourse(){
    const results = byId('lb-results');
    const view = byId('lb-courseview');
    const empty = byId('lb-empty');
    const loading = byId('lb-loading');

    if (!st.active){
      if (st.typesSelected.size > 0 || (st.q||'').trim().length >= 2){ results?.setAttribute('hidden',''); runSearch(); return; }
      results?.setAttribute('hidden',''); view.innerHTML=''; empty.removeAttribute('hidden'); loading.setAttribute('hidden',''); return;
    }

    results?.setAttribute('hidden',''); empty.setAttribute('hidden',''); view.innerHTML=''; loading.removeAttribute('hidden');
    const typesCSV = Array.from(st.typesSelected).join(',');
    const qtxt     = (st.q||'').trim();

    listActivities(st.active, qtxt, typesCSV)
      .then(data=>{ loading.setAttribute('hidden',''); renderSections(view, data.sections||[]); })
      .catch(()=> loading.setAttribute('hidden',''));
  }

  /* =================== boot =================== */
  document.addEventListener('DOMContentLoaded', ()=>{
    document.addEventListener('click', (e)=>{
      const focusBtn   = e.target.closest && e.target.closest('.js-focus-search');
      const openCourse = e.target.closest && e.target.closest('.js-open-courses');
      const openTypes  = e.target.closest && e.target.closest('.js-open-types');

      if (focusBtn){
        e.preventDefault();
        byId('lb-input')?.focus();
      } else if (openCourse){
        e.preventDefault();
        const willOpen = byId('ms-panel')?.hasAttribute('hidden');
        if (willOpen) toggleAccordion('ms-trigger','ms-panel');
        byId('ms-input')?.focus();
      } else if (openTypes){
        e.preventDefault();
        const willOpen = byId('mt-panel')?.hasAttribute('hidden');
        if (willOpen) toggleAccordion('mt-trigger','mt-panel');
        byId('mt-input')?.focus();
      }
    });

    const root = byId('lb-root'); if(!root) return;
    document.body.classList.add('lb-noscroll');

    st.endpoint = root.dataset.endpoint || '';
    st.sesskey  = root.dataset.sesskey  || '';
    st.wwwroot  = root.dataset.wwwroot  || location.origin;
    st.svg.down = root.dataset.svgdown || '';
    st.svg.up   = root.dataset.svgup   || '';
    try{ st.icons = JSON.parse(root.dataset.icons||'{}')||{}; }catch(e){ st.icons={}; }
    st.strings = {
      viewactivity: root.dataset.viewactivity || 'Abrir actividad',
      sections:     root.dataset.sections     || 'Secciones',
      nosections:   root.dataset.nosections   || 'Sin secciones',
    };

    if (RESET_ON_OPEN) {
      try { runSearch.cancel && runSearch.cancel(); } catch(e){}
      st.selected.clear(); st.typesSelected.clear();
      st.active = 0; st.activeName = ''; st.q=''; st.mode='course';
      st.cacheCourses.clear();
      try{
        localStorage.removeItem(LS.selected);
        localStorage.removeItem(LS.active);
        localStorage.removeItem(LS.selectedTypes);
      }catch(e){}
      byId('lb-input') && (byId('lb-input').value = '');
      byId('ms-input') && (byId('ms-input').value = '');
      byId('mt-input') && (byId('mt-input').value = '');
      byId('ms-count') && (byId('ms-count').textContent = 'Todos');
      byId('mt-count') && (byId('mt-count').textContent = 'Todos');
      const results = byId('lb-results'); if (results){ results.innerHTML=''; results.setAttribute('hidden',''); }
      const view    = byId('lb-courseview'); if (view) view.innerHTML='';
      const empty   = byId('lb-empty'); if (empty) empty.removeAttribute('hidden');
    } else {
      restoreSelected(); restoreSelectedTypes();
    }

    const header = byId('lb-header');
    if (header && !byId('lb-course-tabs-global')){
      const row = document.createElement('div');
      row.id = 'lb-tabs-row';
      row.className = 'lb-tabs-row';
      row.innerHTML = `<div id="lb-course-tabs-global" class="lb-tabs-h" role="tablist" aria-label="${esc(st.strings.sections||'Cursos')}" hidden></div>`;
      header.insertAdjacentElement('afterend', row);
    }
    byId('lb-course-tabs-top')?.remove();
    byId('lb-left')?.querySelector('.lb-left-body')?.style.setProperty('scrollbar-gutter','stable');

    const panel = qs('.lb-panel');
    if (panel){
      panel.classList.add('animate__animated','animate__fadeInDown');
      const handleClose = ()=>{
        resetAllFilters();
        panel.classList.remove('animate__fadeInDown');
        panel.classList.add('animate__fadeOutUp');
        const done = ()=>{
          byId('lb-root')?.remove();
          document.body.classList.remove('lb-noscroll');
        };
        panel.addEventListener('animationend', done, {once:true});
        setTimeout(done, 300);
      };
      byId('lb-close')?.addEventListener('click', handleClose);
      document.addEventListener('keydown', e=>{ if (e.key === 'Escape') handleClose(); });
    }

    document.addEventListener('click', (e)=>{
      const a = e.target && e.target.closest ? e.target.closest('a.lb-act-link') : null;
      if (a && a.closest('#lb-root')) {
        try { window.LocalBuscador && window.LocalBuscador.resetAll && window.LocalBuscador.resetAll(); } catch(e){}
      }
    }, true);

    // Cursos (acordeón)
    const msInput = byId('ms-input');
    byId('ms-trigger')?.addEventListener('click', ()=>{
      const willOpen = byId('ms-panel')?.hasAttribute('hidden');
      toggleAccordion('ms-trigger','ms-panel');
      if (willOpen){ if (msInput) msInput.value=''; loadDropdownCourses(''); }
    });
    msInput?.addEventListener('input', debounce(()=> loadDropdownCourses(msInput.value||''), 160));
    byId('ms-input-clear')?.addEventListener('click', ()=>{ if (msInput){ msInput.value=''; loadDropdownCourses(''); msInput.focus(); } });
    byId('ms-clear')?.addEventListener('click', ()=>{
      st.selected.clear(); st.active = 0; st.activeName = '';
      saveSelected(); updateCourseCount(); renderTabs();
      if (msInput) msInput.value=''; loadDropdownCourses('');
      routeAfterFiltersChange();
    });

    // Tipos (acordeón)
    const mtInput = byId('mt-input');
    byId('mt-trigger')?.addEventListener('click', async ()=>{
      const willOpen = byId('mt-panel')?.hasAttribute('hidden');
      toggleAccordion('mt-trigger','mt-panel');
      if (willOpen){
        if (!st.typesCatalog.length){ st.typesCatalog = await fetchTypesRobust(); }
        if (mtInput) mtInput.value=''; loadDropdownTypes('');
      }
    });
    mtInput?.addEventListener('input', debounce(()=> loadDropdownTypes(mtInput.value||''), 160));
    byId('mt-input-clear')?.addEventListener('click', ()=>{ if (mtInput){ mtInput.value=''; loadDropdownTypes(''); mtInput.focus(); } });
    byId('mt-clear')?.addEventListener('click', ()=>{
      st.typesSelected.clear(); saveSelectedTypes(); updateTypeCount();
      if (mtInput) mtInput.value=''; loadDropdownTypes('');
      routeAfterFiltersChange();
    });

    // Buscador global
    const input = byId('lb-input');
    if (input){
      input.value = ''; st.q = '';
      input.addEventListener('input', e=>{ st.q=(e.target.value||'').trim(); routeAfterFiltersChange(); });
      byId('lb-clear')?.addEventListener('click', ()=>{ input.value=''; st.q=''; input.focus(); routeAfterFiltersChange(); });
    }

    // Cargas iniciales
    Promise.all([ listCourses('',1,300), fetchTypesRobust() ])
      .then(([,typesList])=>{
        st.typesCatalog = typesList;
        loadDropdownCourses(''); renderTabs(); loadDropdownTypes('');
        if (!st.active && st.typesSelected.size > 0){ runSearch(); } else { showActiveCourse(); }
      })
      .catch(()=>{
        st.typesCatalog = DEFAULT_TYPES.slice();
        loadDropdownCourses(''); renderTabs(); loadDropdownTypes(''); showActiveCourse();
      });
  });

  function toggleAccordion(triggerId, panelId){
    const trig = byId(triggerId), panel= byId(panelId); if (!trig || !panel) return;
    const willOpen = panel.hasAttribute('hidden');
    if (willOpen){ panel.removeAttribute('hidden'); trig.setAttribute('aria-expanded','true'); trig.classList.add('is-open'); }
    else { trig.setAttribute('aria-expanded','false'); trig.classList.remove('is-open'); panel.setAttribute('hidden',''); }
  }

})();
