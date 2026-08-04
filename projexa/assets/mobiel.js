/* ==========================================================================
   Projexa — smartphone-versie (klantportaal)
   Dezelfde data als de webversie, maar vanuit het gezichtspunt van de klant:
   berichten van de aannemer staan links, die van de klant rechts.
   ========================================================================== */

(function () {
  'use strict';

  const D = window.PROJEXA;
  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const root = document.getElementById('m-start').closest('.m-app');
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

  /* ---- Tabs ------------------------------------------------------------- */

  const koppen = {
    start:     ['Mijn verbouwing', 'Verbouwing Jansen · Amsterdam'],
    berichten: ['Berichten', 'Verbouwing Jansen'],
    uren:      ['Urenregistratie', 'Vandaag, 1 mei 2024'],
    meerwerk:  ['Meerwerk', 'Verbouwing Jansen'],
    meer:      ['Mijn project', 'Verbouwing Jansen · Amsterdam']
  };

  function toon(tab, focus) {
    if (!koppen[tab]) tab = 'start';
    $$('.m-screen', root).forEach(s => { s.hidden = s.id !== 'm-' + tab; });
    $$('.m-tab', root).forEach(b => {
      if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $('#mTitle').textContent = koppen[tab][0];
    $('#mSub').textContent = koppen[tab][1];
    $('#mBack').classList.toggle('is-visible', tab !== 'start');
    document.title = 'Projexa — ' + koppen[tab][0];

    if (tab === 'berichten') {
      $('#mChatDot').hidden = true;
      setTimeout(scrollChat, 0);
    }
    const main = $('.m-main', root);
    if (focus) {
      const doel = document.getElementById(focus);
      if (doel) { doel.scrollIntoView({ block: 'start' }); return; }
    }
    main.scrollTop = 0;
    window.scrollTo({ top: 0 });
  }

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-tab]');
    if (el) toon(el.dataset.tab, el.dataset.focus);
  });

  $('#mBack').addEventListener('click', () => toon('start'));
  $('#mBell').addEventListener('click', () => toast('3 nieuwe meldingen — push en e-mail staan aan'));

  /* ---- Laatste updates --------------------------------------------------- */

  $('#mUpdates').innerHTML = D.updates.map(u =>
    '<div class="m-update"><span class="m-ico' + (u.stijl ? ' m-ico--' + u.stijl : '') + '">' +
    icon(u.icon, 18) + '</span><span><b>' + escapeHtml(u.tekst) + '</b><small>' +
    escapeHtml(u.tijd) + '</small></span></div>'
  ).join('');

  /* ---- Chat -------------------------------------------------------------- */

  const gesprek = D.gesprekken[0];

  function bubbel(m) {
    // In het klantportaal is de klant "ik".
    const mijn = m.van === 'klant';
    const meta = '<span class="m-bubble__meta">' + m.tijd +
      (mijn ? ' <span class="read">' + icon('i-checks', 12) + '</span>' : '') + '</span>';
    if (m.foto) {
      return '<div class="m-bubble m-bubble--photo' + (mijn ? ' m-bubble--me' : '') + '">' +
        '<svg viewBox="0 0 160 90" role="img" aria-label="Foto in het gesprek"><use href="#' + m.foto + '"></use></svg>' +
        meta + '</div>';
    }
    return '<div class="m-bubble' + (mijn ? ' m-bubble--me' : '') + '">' +
      escapeHtml(m.tekst) + meta + '</div>';
  }

  function tekenChat() {
    $('#mChat').innerHTML = gesprek.berichten.map(bubbel).join('');
    scrollChat();
  }

  function scrollChat() {
    const laatste = $('#mChat').lastElementChild;
    if (laatste) laatste.scrollIntoView({ block: 'nearest' });
  }

  function nu() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  $('#mComposer').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#mInput');
    const tekst = input.value.trim();
    if (!tekst) return;
    gesprek.berichten.push({ van: 'klant', tekst: tekst, tijd: nu() });
    input.value = '';
    tekenChat();
  });

  $('#mPhoto').addEventListener('click', () => {
    gesprek.berichten.push({ van: 'klant', foto: 'ph-beams', tijd: nu() });
    tekenChat();
    toast('Foto verstuurd');
  });

  $('#mVoice').addEventListener('click', () => toast('Spraakbericht opnemen — houd ingedrukt'));

  /* ---- Urenregistratie ---------------------------------------------------- */

  const uren = { seconden: 7 * 3600 + 30 * 60 + 45, loopt: true, gepauzeerd: false };

  function formatteer(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return [h, m, sec].map(n => String(n).padStart(2, '0')).join(':');
  }

  function tekenTimer() {
    $('#mTimer').textContent = formatteer(uren.seconden);
    $('#mEntryTime').textContent = formatteer(uren.seconden);
  }

  setInterval(() => {
    if (uren.loopt && !uren.gepauzeerd) { uren.seconden++; tekenTimer(); }
  }, 1000);

  $('#mStop').addEventListener('click', () => {
    const btn = $('#mStop');
    if (uren.loopt) {
      uren.loopt = false;
      uren.gepauzeerd = false;
      btn.textContent = 'Start';
      btn.classList.remove('btn--red');
      btn.classList.add('btn--gold');
      $('#mPause').textContent = 'Pauze';
      toast('Uren opgeslagen: ' + formatteer(uren.seconden));
    } else {
      uren.loopt = true;
      btn.textContent = 'Stop';
      btn.classList.remove('btn--gold');
      btn.classList.add('btn--red');
      toast('Timer gestart');
    }
  });

  $('#mPause').addEventListener('click', () => {
    if (!uren.loopt) { toast('Timer staat stil — druk op Start'); return; }
    uren.gepauzeerd = !uren.gepauzeerd;
    $('#mPause').textContent = uren.gepauzeerd ? 'Hervat' : 'Pauze';
    toast(uren.gepauzeerd ? 'Timer gepauzeerd' : 'Timer hervat');
  });

  const taak = $('#mTask');
  taak.addEventListener('change', () => {
    $('#mTaskSub').textContent = taak.value;
    $('#mEntryText').textContent = taak.options[taak.selectedIndex].text + ' — ' + taak.value;
  });

  const fotoReeks = ['ph-1', 'ph-2', 'ph-3'];
  let fotoTeller = 0;

  $('#mAddPhoto').addEventListener('click', () => {
    const fig = document.createElement('figure');
    fig.innerHTML = '<svg viewBox="0 0 60 60" role="img" aria-label="Nieuwe foto"><use href="#' +
      fotoReeks[fotoTeller++ % fotoReeks.length] + '"></use></svg>';
    $('#mPhotos').insertBefore(fig, $('#mAddPhoto'));
    toast('Foto toegevoegd aan het projectlogboek');
  });

  const dagen = ['ma 29 apr 2024', 'di 30 apr 2024', 'Vandaag, 1 mei 2024', 'do 2 mei 2024', 'vr 3 mei 2024'];
  let dagIndex = 2;

  function tekenDag() {
    $('#mDayLabel').textContent = dagen[dagIndex];
    if (!$('#m-uren').hidden) $('#mSub').textContent = dagen[dagIndex];
  }

  $('#mDayPrev').addEventListener('click', () => { dagIndex = Math.max(0, dagIndex - 1); tekenDag(); });
  $('#mDayNext').addEventListener('click', () => { dagIndex = Math.min(dagen.length - 1, dagIndex + 1); tekenDag(); });

  /* ---- Meerwerk ----------------------------------------------------------- */

  $('#mMwDetailBtn').addEventListener('click', () => {
    const box = $('#mMwDetails');
    box.hidden = !box.hidden;
    $('#mMwDetailBtn').textContent = box.hidden ? 'Bekijk details' : 'Verberg details';
  });

  $('#mMwOk').addEventListener('click', () => {
    const btn = $('#mMwOk');
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = 'Goedgekeurd';
    const tag = $('#mMwStatus');
    tag.textContent = 'Goedgekeurd';
    tag.className = 'tag tag--ok';
    tag.style.marginTop = '6px';
    $$('#m-start .tag', root).forEach(t => {
      if (t.textContent === 'In afwachting') { t.textContent = 'Goedgekeurd'; t.className = 'tag tag--ok'; t.style.marginTop = '6px'; }
    });
    toast('Meerwerk goedgekeurd — de aannemer krijgt een notificatie');
  });

  /* ---- Start --------------------------------------------------------------- */

  tekenChat();
  tekenTimer();
  tekenDag();
  toon('start');
})();
