/* ==========================================================================
   Projexa — werkende webversie
   ========================================================================== */

(function () {
  'use strict';

  const D = window.PROJEXA;
  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ---- Meldingen -------------------------------------------------------- */

  const toastEl = $('#toast');
  let toastTimer;

  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 2600);
  }

  function icon(name, size) {
    return '<svg width="' + size + '" height="' + size + '" aria-hidden="true"><use href="#' + name + '"></use></svg>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* ---- Navigatie -------------------------------------------------------- */

  const titels = {
    dashboard: 'Dashboard', projecten: 'Projecten', chat: 'Chat', uren: 'Urenregistratie',
    meerwerk: 'Meerwerk', planning: 'Planning', documenten: 'Documenten', klanten: 'Klantportaal'
  };

  function toon(view) {
    if (!titels[view]) view = 'dashboard';
    $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + view; });
    $$('.nav__item').forEach(b => {
      if (b.dataset.view === view) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    document.title = 'Projexa — ' + titels[view];
    if (view === 'chat') {
      $('#chatBadge').hidden = true;
      scrollChat();
    }
    window.scrollTo({ top: 0 });
  }

  $$('.nav__item').forEach(b => {
    b.addEventListener('click', () => { location.hash = b.dataset.view; });
  });

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-goto]');
    if (el) location.hash = el.dataset.goto;
  });

  window.addEventListener('hashchange', () => toon(location.hash.slice(1)));

  /* ---- Projectenoverzicht ----------------------------------------------- */

  function projectRij(p) {
    return '<button class="project" type="button" data-goto="' + p.view + '">' +
      '<svg class="project__icon" width="24" height="24" aria-hidden="true"><use href="#' + p.icon + '"></use></svg>' +
      '<span><span class="project__name">' + escapeHtml(p.naam) + '</span>' +
      '<span class="project__place">' + escapeHtml(p.plaats) + '</span></span>' +
      '<span><span class="project__pct">' + p.pct + '%</span>' +
      '<span class="bar"><i style="width:' + p.pct + '%"></i></span></span></button>';
  }

  function tekenProjecten() {
    $('#projectList').innerHTML = D.projecten.map(projectRij).join('');
    $('#projectList2').innerHTML = D.projecten.map(projectRij).join('');
    $('#statTotaal').textContent = 8 + D.projecten.length;
  }

  function nieuwProject() {
    const naam = prompt('Naam van het project:');
    if (!naam) return;
    const plaats = prompt('Plaats:') || '';
    D.projecten.push({ naam: naam.trim(), plaats: plaats.trim(), pct: 0, icon: 'i-building', view: 'planning' });
    tekenProjecten();
    voegActiviteitToe('Project “' + naam.trim() + '” toegevoegd', 'zojuist', 'i-building', 'gold');
    toast('Project toegevoegd');
  }

  $('#addProject').addEventListener('click', nieuwProject);
  $('#addProject2').addEventListener('click', nieuwProject);

  function voegActiviteitToe(tekst, tijd, ico, stijl) {
    const el = document.createElement('div');
    el.className = 'activity';
    el.innerHTML = '<span class="activity__icon' + (stijl ? ' activity__icon--' + stijl : '') + '">' +
      icon(ico, 17) + '</span><span><span class="activity__text">' + escapeHtml(tekst) +
      '</span><span class="activity__time">' + escapeHtml(tijd) + '</span></span>';
    const lijst = $('#activityList');
    lijst.insertBefore(el, lijst.firstChild);
  }

  /* ---- Chat ------------------------------------------------------------- */

  let actiefGesprek = D.gesprekken[0].id;

  function tekenChatlijst(filter) {
    const q = (filter || '').trim().toLowerCase();
    const items = D.gesprekken.filter(g =>
      !q || g.naam.toLowerCase().includes(q) || g.preview.toLowerCase().includes(q)
    );
    $('#chatList').innerHTML = items.map(g =>
      '<button class="chat__item" type="button" role="option" data-chat="' + g.id + '"' +
      ' aria-selected="' + (g.id === actiefGesprek) + '">' +
      '<span class="thumb">' + icon(g.icon, 17) + '</span>' +
      '<span><h4>' + escapeHtml(g.naam) + '</h4><p>' + escapeHtml(g.preview) + '</p></span>' +
      '<time>' + g.tijd + '</time></button>'
    ).join('') || '<p style="padding:16px;color:var(--ink-3);font-size:13.5px">Geen gesprekken gevonden.</p>';

    $$('#chatList .chat__item').forEach(b => {
      b.addEventListener('click', () => {
        actiefGesprek = b.dataset.chat;
        tekenChatlijst($('#chatSearch').value);
        tekenBerichten();
      });
    });
  }

  function bubbel(m) {
    const mine = m.van === 'ik';
    const meta = '<span class="bubble__meta">' + m.tijd +
      (mine && m.gelezen ? ' <span class="read">' + icon('i-checks', 12) + '</span>' : '') + '</span>';
    if (m.foto) {
      return '<div class="bubble bubble--photo' + (mine ? ' bubble--me' : '') + '">' +
        '<svg viewBox="0 0 160 90" role="img" aria-label="Foto in het gesprek"><use href="#' + m.foto + '"></use></svg>' +
        meta + '</div>';
    }
    return '<div class="bubble' + (mine ? ' bubble--me' : '') + '">' +
      escapeHtml(m.tekst) + meta + '</div>';
  }

  function huidigGesprek() {
    return D.gesprekken.find(g => g.id === actiefGesprek) || D.gesprekken[0];
  }

  function tekenBerichten() {
    const g = huidigGesprek();
    $('#chatTitle').textContent = 'Chat - ' + g.naam;
    $('#chatMessages').innerHTML = g.berichten.map(bubbel).join('');
    scrollChat();
  }

  function scrollChat() {
    const box = $('#chatMessages');
    if (box) box.scrollTop = box.scrollHeight;
  }

  function nu() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  $('#composer').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#chatInput');
    const tekst = input.value.trim();
    if (!tekst) return;
    const g = huidigGesprek();
    g.berichten.push({ van: 'ik', tekst: tekst, tijd: nu(), gelezen: false });
    g.preview = 'Jij: ' + tekst;
    g.tijd = nu();
    input.value = '';
    tekenBerichten();
    tekenChatlijst($('#chatSearch').value);

    // leesbevestiging na een moment
    setTimeout(() => {
      const laatste = g.berichten[g.berichten.length - 1];
      if (laatste) laatste.gelezen = true;
      if (huidigGesprek().id === g.id) tekenBerichten();
    }, 1400);
  });

  $('#chatSearch').addEventListener('input', e => tekenChatlijst(e.target.value));

  $('#btnPhoto').addEventListener('click', () => {
    const g = huidigGesprek();
    g.berichten.push({ van: 'ik', foto: 'ph-beams', tijd: nu(), gelezen: false });
    g.preview = 'Jij: Foto toegevoegd';
    g.tijd = nu();
    tekenBerichten();
    tekenChatlijst($('#chatSearch').value);
    toast('Foto toegevoegd aan het gesprek');
  });

  $('#btnVoice').addEventListener('click', () => toast('Spraakbericht opnemen — houd ingedrukt'));

  /* ---- Urenregistratie -------------------------------------------------- */

  const uren = { seconden: 7 * 3600 + 30 * 60 + 45, loopt: true, gepauzeerd: false };

  function formatteer(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return [h, m, sec].map(n => String(n).padStart(2, '0')).join(':');
  }

  function tekenTimer() {
    $('#timerValue').textContent = formatteer(uren.seconden);
    const entry = $('#entryList .entry b');
    if (entry) entry.textContent = formatteer(uren.seconden);
  }

  setInterval(() => {
    if (uren.loopt && !uren.gepauzeerd) { uren.seconden++; tekenTimer(); }
  }, 1000);

  $('#btnStop').addEventListener('click', () => {
    const btn = $('#btnStop');
    if (uren.loopt) {
      uren.loopt = false;
      uren.gepauzeerd = false;
      btn.textContent = 'Start';
      btn.classList.remove('btn--red');
      btn.classList.add('btn--gold');
      $('#btnPause').textContent = 'Pauze';
      voegActiviteitToe('Uren geregistreerd (' + formatteer(uren.seconden) + ')', 'zojuist', 'i-clock', 'gold');
      toast('Uren opgeslagen: ' + formatteer(uren.seconden));
    } else {
      uren.loopt = true;
      btn.textContent = 'Stop';
      btn.classList.remove('btn--gold');
      btn.classList.add('btn--red');
      toast('Timer gestart');
    }
  });

  $('#btnPause').addEventListener('click', () => {
    if (!uren.loopt) { toast('Timer staat stil — druk op Start'); return; }
    uren.gepauzeerd = !uren.gepauzeerd;
    $('#btnPause').textContent = uren.gepauzeerd ? 'Hervat' : 'Pauze';
    toast(uren.gepauzeerd ? 'Timer gepauzeerd' : 'Timer hervat');
  });

  const taakSelect = $('#taskSelect');
  taakSelect.addEventListener('change', () => {
    $('#taskSub').textContent = taakSelect.value;
    const entry = $('#entryList .entry span');
    if (entry) entry.textContent = taakSelect.options[taakSelect.selectedIndex].text + ' — ' + taakSelect.value;
  });

  const fotoReeks = ['ph-1', 'ph-2', 'ph-3'];
  let fotoTeller = 0;

  $('#addPhoto').addEventListener('click', () => {
    const fig = document.createElement('figure');
    const naam = fotoReeks[fotoTeller++ % fotoReeks.length];
    fig.innerHTML = '<svg viewBox="0 0 60 60" role="img" aria-label="Nieuwe foto"><use href="#' + naam + '"></use></svg>';
    $('#photoGrid').insertBefore(fig, $('#addPhoto'));
    voegActiviteitToe('Foto toegevoegd aan het projectlogboek', 'zojuist', 'i-camera', '');
    toast('Foto toegevoegd aan het projectlogboek');
  });

  const dagen = ['ma 29 apr 2024', 'di 30 apr 2024', 'Vandaag, 1 mei 2024', 'do 2 mei 2024', 'vr 3 mei 2024'];
  let dagIndex = 2;

  function tekenDag() { $('#dayLabel').textContent = dagen[dagIndex]; }

  $('#dayPrev').addEventListener('click', () => {
    dagIndex = Math.max(0, dagIndex - 1); tekenDag();
  });
  $('#dayNext').addEventListener('click', () => {
    dagIndex = Math.min(dagen.length - 1, dagIndex + 1); tekenDag();
  });

  /* ---- Meerwerk --------------------------------------------------------- */

  $('#mwDetailBtn').addEventListener('click', () => {
    const box = $('#mwDetails');
    box.hidden = !box.hidden;
    $('#mwDetailBtn').textContent = box.hidden ? 'Bekijk details' : 'Verberg details';
  });

  $('#mwSend').addEventListener('click', () => {
    const btn = $('#mwSend');
    if (btn.dataset.sent) { toast('Dit voorstel is al naar de klant gestuurd'); return; }
    btn.dataset.sent = '1';
    btn.textContent = 'Verstuurd naar klant';
    ['#mwStatus', '#mwStatusList'].forEach(sel => {
      const t = $(sel);
      t.textContent = 'Verstuurd';
      t.className = 'tag tag--sent' + (sel === '#mwStatus' ? '' : '');
      if (sel === '#mwStatus') t.style.marginTop = '8px';
      else t.style.marginLeft = 'auto';
    });
    voegActiviteitToe('Meerwerk MW-2024-001 naar klant gestuurd', 'zojuist', 'i-plus-circle', 'gold');
    toast('Meerwerkvoorstel verstuurd — de klant kan met één klik akkoord geven');
  });

  $('#closeMw').addEventListener('click', () => { location.hash = 'dashboard'; });

  /* ---- Documenten ------------------------------------------------------- */

  $('#uploadDoc').addEventListener('click', () => {
    const naam = prompt('Naam van het document:');
    if (!naam) return;
    const el = document.createElement('div');
    el.className = 'doc';
    el.innerHTML = icon('i-doc', 20) +
      '<span>' + escapeHtml(naam) + '<small>PDF · zojuist geüpload</small></span>';
    const lijst = $('#docList');
    lijst.insertBefore(el, lijst.firstChild);
    toast('Document geüpload');
  });

  /* ---- Start ------------------------------------------------------------ */

  tekenProjecten();
  tekenChatlijst('');
  tekenBerichten();
  tekenTimer();
  tekenDag();
  toon(location.hash.slice(1) || 'dashboard');
})();
