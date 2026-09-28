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
    dashboard: 'Dashboard', projecten: 'Projecten', project: 'Project', chat: 'Chat',
    uren: 'Urenregistratie', meerwerk: 'Meerwerk', planning: 'Planning',
    documenten: 'Documenten', notificaties: 'Notificaties', ai: 'AI assistent',
    klanten: 'Klanten & portaal', gebruikers: 'Gebruikers', facturatie: 'Facturatie',
    abonnement: 'Abonnement'
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
    if (view === 'notificaties') {
      $('#belBadge').hidden = true;
      var dot = $('#belDot');
      if (dot) dot.hidden = true;
    }
    window.scrollTo({ top: 0 });
  }

  $$('.nav__item').forEach(b => {
    b.addEventListener('click', () => { location.hash = b.dataset.view; });
  });

  document.addEventListener('click', e => {
    const ga = e.target.closest('[data-goto]');
    if (ga) { location.hash = ga.dataset.goto; return; }

    const terug = e.target.closest('[data-view-back]');
    if (terug) { location.hash = terug.dataset.viewBack; return; }

    const open = e.target.closest('[data-view-open]');
    if (open) { location.hash = open.dataset.viewOpen; return; }

    const pr = e.target.closest('[data-project]');
    if (pr) { openProject(Number(pr.dataset.project)); }
  });

  /* ---- Projectdetail ---------------------------------------------------- */

  function openProject(i) {
    const p = D.projecten[i];
    if (!p) return;
    $('#pdNaam').textContent = p.naam;
    $('#pdStatus').textContent = p.status || 'In uitvoering';
    $('#pdStatus').className = 'tag ' + (p.pct === 100 ? 'tag--ok' : 'tag--sent');
    $('#pdPct').textContent = p.pct + '%';
    $('#pdUren').textContent = p.urenTotaal || 0;
    $('#pdMeerwerk').textContent = p.meerwerk || '€0';
    $('#pdKlant').textContent = p.klant || '—';
    $('#pdAdres').textContent = p.plaats;

    const taken = p.taken || [];
    $('#pdTaken').textContent = taken.filter(t => t.staat !== 'klaar').length;
    $('#pdTakenLijst').innerHTML = taken.map(t =>
      '<div class="timeline__day" style="grid-template-columns:22px 1fr auto">' +
      '<span class="dot' + (t.staat === 'klaar' ? ' dot--done' : t.staat === 'bezig' ? '' : ' dot--milestone') + '"></span>' +
      '<span class="timeline__task">' + escapeHtml(t.tekst) + '</span>' +
      '<span class="timeline__date">' + escapeHtml(t.wanneer) + '</span></div>'
    ).join('') || '<p style="padding:16px;color:var(--ink-3)">Geen open taken.</p>';

    location.hash = 'project';
  }

  window.addEventListener('hashchange', () => toon(location.hash.slice(1)));

  /* ---- Projectenoverzicht ----------------------------------------------- */

  function projectRij(p, i) {
    return '<button class="project" type="button" data-project="' + i + '">' +
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
      '<span><h4>' + escapeHtml(g.naam) +
      (g.intern ? ' <em class="intern">intern</em>' : '') +
      '</h4><p>' + escapeHtml(g.preview) + '</p></span>' +
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
    $('#chatTitle').textContent = g.intern
      ? 'Chat - ' + g.naam + ' (medewerker)'
      : 'Chat - ' + g.naam;
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

  const taakSoort = $('#taskSoort');
  const taakWat = $('#taskWat');

  function tekenTaakregel() {
    const entry = $('#entryList .entry span');
    if (!entry) return;
    const soort = taakSoort.value.trim() || 'Werkzaamheden';
    const wat = taakWat.value.trim();
    entry.textContent = wat ? soort + ' — ' + wat : soort;
  }

  taakSoort.addEventListener('input', tekenTaakregel);
  taakWat.addEventListener('input', tekenTaakregel);

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

  const offertes = [];

  function tekenBijlagen() {
    const box = $('#mwBijlagen');
    if (!offertes.length) {
      box.innerHTML = '<p class="bijlagen__leeg" id="mwGeenBijlage">Nog geen offerte toegevoegd.</p>';
      return;
    }
    box.innerHTML = offertes.map((f, i) =>
      '<div class="bijlage">' + icon('i-doc', 18) +
      '<span>' + escapeHtml(f.naam) + '<small>' + escapeHtml(f.grootte) + ' · zojuist toegevoegd</small></span>' +
      '<button type="button" data-offerte-weg="' + i + '" aria-label="Offerte verwijderen">' +
      icon('i-x', 16) + '</button></div>'
    ).join('');
  }

  function leesbareGrootte(bytes) {
    if (!bytes) return 'bestand';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' kB';
    return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
  }

  $('#mwOfferte').addEventListener('change', e => {
    const bestand = e.target.files && e.target.files[0];
    if (!bestand) return;
    offertes.push({ naam: bestand.name, grootte: leesbareGrootte(bestand.size) });
    tekenBijlagen();
    e.target.value = '';
    toast('Offerte toegevoegd aan het meerwerkvoorstel');
  });

  document.addEventListener('click', e => {
    const weg = e.target.closest('[data-offerte-weg]');
    if (!weg) return;
    offertes.splice(Number(weg.dataset.offerteWeg), 1);
    tekenBijlagen();
    toast('Offerte verwijderd');
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
    toast(offertes.length
      ? 'Meerwerkvoorstel met offerte verstuurd — de klant kan met één klik akkoord geven'
      : 'Meerwerkvoorstel verstuurd — de klant kan met één klik akkoord geven');
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

  /* ---- Planning ---------------------------------------------------------- */

  let planIndex = 0;

  function tekenPlanningKiezers() {
    $('#planProject').innerHTML = D.projecten.map((p, i) =>
      '<option value="' + i + '"' + (i === planIndex ? ' selected' : '') + '>' +
      escapeHtml(p.naam) + ' · ' + escapeHtml(p.plaats) + '</option>'
    ).join('');

    $('#planTabs').innerHTML = D.projecten.map((p, i) =>
      '<button type="button" data-plan="' + i + '" aria-current="' + (i === planIndex) + '">' +
      escapeHtml(p.naam) + '</button>'
    ).join('');
  }

  function tekenPlanning() {
    const p = D.projecten[planIndex];
    const dagen = (p && p.planning) || [];
    $('#planTijdlijn').innerHTML = dagen.length ? dagen.map(d =>
      '<div class="timeline__day"><span class="timeline__date">' + escapeHtml(d.datum) + '</span><div>' +
      d.taken.map(t => {
        const klasse = t.staat === 'klaar' ? ' dot--done' : t.staat === 'mijlpaal' ? ' dot--milestone' : '';
        const tekst = t.staat === 'mijlpaal'
          ? '<b>' + escapeHtml(t.tekst) + '</b>'
          : escapeHtml(t.tekst);
        return '<div class="timeline__task"><span class="dot' + klasse + '"></span>' + tekst + '</div>';
      }).join('') + '</div></div>'
    ).join('') : '<p style="padding:20px;color:var(--ink-3)">Nog geen planning voor dit project.</p>';
  }

  function kiesPlanning(i) {
    planIndex = i;
    tekenPlanningKiezers();
    tekenPlanning();
  }

  $('#planProject').addEventListener('change', e => kiesPlanning(Number(e.target.value)));

  document.addEventListener('click', e => {
    const knop = e.target.closest('[data-plan]');
    if (knop) kiesPlanning(Number(knop.dataset.plan));
  });

  $('#planTaak').addEventListener('click', () => {
    const tekst = prompt('Wat moet er gebeuren?');
    if (!tekst) return;
    const wanneer = prompt('Wanneer? (bijvoorbeeld: ma 6 mei)', 'ma 6 mei') || 'nog te plannen';
    const p = D.projecten[planIndex];
    p.planning = p.planning || [];
    p.planning.push({ datum: wanneer.trim(), taken: [{ tekst: tekst.trim(), staat: 'open' }] });
    tekenPlanning();
    toast('Taak toegevoegd aan ' + p.naam);
  });

  /* ---- Notificaties, AI, beheer ----------------------------------------- */

  $('#allesGelezen').addEventListener('click', () => {
    $('#notiNieuw').innerHTML =
      '<p style="padding:20px;color:var(--ink-3);font-size:14px">Je bent helemaal bij.</p>';
    $('#belBadge').hidden = true;
    const dot = $('#belDot');
    if (dot) dot.hidden = true;
    toast('Alle meldingen gelezen');
  });

  $('#aiSamenvatting').addEventListener('click', () =>
    toast('Gesprek opnieuw samengevat'));

  $('#nodigUit').addEventListener('click', () => {
    const naam = prompt('Naam van de nieuwe gebruiker:');
    if (!naam) return;
    const rol = prompt('Welke rol? (aannemer, medewerker of klant)', 'medewerker') || 'medewerker';
    const initialen = naam.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const el = document.createElement('div');
    el.className = 'doc';
    el.innerHTML = '<span class="avatar">' + escapeHtml(initialen) + '</span><span>' +
      escapeHtml(naam.trim()) + '<small>uitnodiging verstuurd</small></span>' +
      '<span class="tag">' + escapeHtml(rol.trim()) + '</span>';
    $('#gebruikersLijst').appendChild(el);
    toast('Uitnodiging verstuurd naar ' + naam.trim());
  });

  $('#nieuweFactuur').addEventListener('click', () => {
    const el = document.createElement('div');
    el.className = 'doc';
    el.innerHTML = icon('i-euro', 20) +
      '<span>2024-0032 · Verbouwing Jansen<small>Concept · nog te verzenden</small></span>' +
      '<span class="tag">Concept</span>';
    $('#factuurLijst').insertBefore(el, $('#factuurLijst').firstChild);
    toast('Conceptfactuur aangemaakt');
  });

  $('#abonneer').addEventListener('click', () =>
    toast('Je wordt doorgestuurd naar Stripe om de incasso te regelen'));

  $('#opzeggen').addEventListener('click', () =>
    toast('Opzeggen kan maandelijks — je houdt toegang tot het einde van de maand'));

  document.addEventListener('click', e => {
    const r = e.target.closest('[data-rapport]');
    if (r) toast(r.dataset.rapport + ' wordt als PDF gedownload');
  });

  /* ---- Start ------------------------------------------------------------ */

  tekenProjecten();
  tekenPlanningKiezers();
  tekenPlanning();
  tekenBijlagen();
  tekenChatlijst('');
  tekenBerichten();
  tekenTimer();
  tekenDag();
  toon(location.hash.slice(1) || 'dashboard');
})();
