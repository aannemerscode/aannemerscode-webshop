/* ==========================================================================
   Projexa — medewerker-app
   Rechten volgens het ontwerp: uren registreren, werkzaamheden invullen,
   foto's uploaden en chatten binnen projecten.
   ========================================================================== */

(function () {
  'use strict';

  const D = window.PROJEXA;
  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const root = document.getElementById('w-vandaag').closest('.m-app');
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

  /* ---- Tabs -------------------------------------------------------------- */

  const koppen = {
    vandaag: ['Mijn werk', 'Piet Vermeer · medewerker'],
    werk:    ['Werkzaamheden', 'Verbouwing Jansen'],
    fotos:   ['Foto’s', 'Verbouwing Jansen'],
    chat:    ['Chat', 'Verbouwing Jansen']
  };

  function toon(tab) {
    if (!koppen[tab]) tab = 'vandaag';
    $$('.m-screen', root).forEach(s => { s.hidden = s.id !== 'w-' + tab; });
    $$('.m-tab', root).forEach(b => {
      if (b.dataset.wtab === tab) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $('#wTitle').textContent = koppen[tab][0];
    $('#wSub').textContent = koppen[tab][1];
    $('#wBack').classList.toggle('is-visible', tab !== 'vandaag');
    document.title = 'Projexa — ' + koppen[tab][0];
    if (tab === 'chat') { $('#wChatDot').hidden = true; setTimeout(scrollChat, 0); }
    $('.m-main', root).scrollTop = 0;
    window.scrollTo({ top: 0 });
  }

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-wtab]');
    if (el) toon(el.dataset.wtab);
  });

  $('#wBack').addEventListener('click', () => toon('vandaag'));
  $('#wBell').addEventListener('click', () => toast('Nieuwe planning voor morgen beschikbaar'));

  /* ---- Urenregistratie ---------------------------------------------------- */

  const uren = { seconden: 7 * 3600 + 30 * 60 + 45, loopt: true, gepauzeerd: false };

  function formatteer(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return [h, m, sec].map(n => String(n).padStart(2, '0')).join(':');
  }

  function korteTijd(s) {
    return String(Math.floor(s / 3600)).padStart(2, '0') + ':' +
           String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  }

  function tekenTimer() {
    $('#wTimer').textContent = formatteer(uren.seconden);
    $('#wEntryTime').textContent = formatteer(uren.seconden);
    $('#wWeek').textContent = korteTijd(16 * 3600 + uren.seconden);
  }

  setInterval(() => {
    if (uren.loopt && !uren.gepauzeerd) { uren.seconden++; tekenTimer(); }
  }, 1000);

  $('#wStop').addEventListener('click', () => {
    const btn = $('#wStop');
    if (uren.loopt) {
      uren.loopt = false;
      uren.gepauzeerd = false;
      btn.textContent = 'Start';
      btn.classList.remove('btn--red');
      btn.classList.add('btn--gold');
      $('#wPause').textContent = 'Pauze';
      toast('Uren opgeslagen: ' + formatteer(uren.seconden));
    } else {
      uren.loopt = true;
      btn.textContent = 'Stop';
      btn.classList.remove('btn--gold');
      btn.classList.add('btn--red');
      toast('Timer gestart');
    }
  });

  $('#wPause').addEventListener('click', () => {
    if (!uren.loopt) { toast('Timer staat stil — druk op Start'); return; }
    uren.gepauzeerd = !uren.gepauzeerd;
    $('#wPause').textContent = uren.gepauzeerd ? 'Hervat' : 'Pauze';
    toast(uren.gepauzeerd ? 'Timer gepauzeerd' : 'Timer hervat');
  });

  const taak = $('#wTask');
  const project = $('#wProject');

  function tekenEntry() {
    $('#wEntryText').innerHTML = escapeHtml(taak.options[taak.selectedIndex].text) +
      ' — ' + escapeHtml(taak.value) + '<small>' +
      escapeHtml(project.value.split(' · ')[0]) + '</small>';
  }

  taak.addEventListener('change', () => { $('#wTaskSub').textContent = taak.value; tekenEntry(); });
  project.addEventListener('change', () => {
    tekenEntry();
    toast('Je schrijft nu op ' + project.value.split(' · ')[0]);
  });

  $('#wHandmatig').addEventListener('click', () => {
    const invoer = prompt('Hoeveel uur wil je bijschrijven? (bijvoorbeeld 1:30)', '1:30');
    if (!invoer) return;
    const delen = invoer.split(':');
    const extra = (parseInt(delen[0], 10) || 0) * 3600 + (parseInt(delen[1], 10) || 0) * 60;
    if (!extra) { toast('Vul een tijd in als 1:30'); return; }
    uren.seconden += extra;
    tekenTimer();
    toast(korteTijd(extra) + ' uur bijgeschreven');
  });

  const dagen = ['ma 29 apr 2024', 'di 30 apr 2024', 'Vandaag, 1 mei 2024', 'do 2 mei 2024', 'vr 3 mei 2024'];
  let dagIndex = 2;

  function tekenDag() {
    $('#wDayLabel').textContent = dagen[dagIndex];
    if (!$('#w-vandaag').hidden) $('#wSub').textContent = 'Piet Vermeer · medewerker';
  }

  $('#wDayPrev').addEventListener('click', () => { dagIndex = Math.max(0, dagIndex - 1); tekenDag(); });
  $('#wDayNext').addEventListener('click', () => { dagIndex = Math.min(dagen.length - 1, dagIndex + 1); tekenDag(); });

  /* ---- Werkzaamheden invullen --------------------------------------------- */

  const fotoReeks = ['ph-1', 'ph-2', 'ph-3'];
  let fotoTeller = 0;

  function nieuweFoto(doel, voor) {
    const fig = document.createElement('figure');
    fig.innerHTML = '<svg viewBox="0 0 60 60" role="img" aria-label="Nieuwe foto"><use href="#' +
      fotoReeks[fotoTeller++ % fotoReeks.length] + '"></use></svg>';
    if (voor) doel.insertBefore(fig, voor);
    else doel.insertBefore(fig, doel.firstChild);
  }

  $('#wLogFoto').addEventListener('click', () => {
    nieuweFoto($('#wLogFotos'), $('#wLogFoto'));
    toast('Foto toegevoegd');
  });

  $('#wLogOpslaan').addEventListener('click', () => {
    const soort = $('#wLogSoort').value;
    const tekst = $('#wLogTekst').value.trim();
    if (!tekst) { toast('Vul kort in wat je hebt gedaan'); $('#wLogTekst').focus(); return; }
    const el = document.createElement('div');
    el.className = 'm-item';
    el.innerHTML = '<span class="m-ico">' + icon('i-worker', 18) + '</span><span>' +
      escapeHtml(soort) + '<small>zojuist · ' + escapeHtml(tekst) + '</small></span>';
    const lijst = $('#wLogboek');
    lijst.insertBefore(el, lijst.firstChild);
    $('#wLogTekst').value = '';
    toast('Opgeslagen in het projectlogboek');
  });

  /* ---- Foto's -------------------------------------------------------------- */

  $('#wFotoMaken').addEventListener('click', () => {
    nieuweFoto($('#wGalerij'));
    toast('Foto gemaakt en gelogd bij Verbouwing Jansen');
  });

  $('#wFotoUpload').addEventListener('click', () => {
    nieuweFoto($('#wGalerij'));
    toast('Foto geüpload');
  });

  /* ---- Chat ---------------------------------------------------------------- */

  const gesprek = D.gesprekken[0];

  function bubbel(m) {
    const mijn = m.van === 'ik';   // de medewerker hoort bij het team van de aannemer
    const meta = '<span class="m-bubble__meta">' + m.tijd +
      (mijn && m.gelezen ? ' <span class="read">' + icon('i-checks', 12) + '</span>' : '') + '</span>';
    if (m.foto) {
      return '<div class="m-bubble m-bubble--photo' + (mijn ? ' m-bubble--me' : '') + '">' +
        '<svg viewBox="0 0 160 90" role="img" aria-label="Foto in het gesprek"><use href="#' + m.foto + '"></use></svg>' +
        meta + '</div>';
    }
    return '<div class="m-bubble' + (mijn ? ' m-bubble--me' : '') + '">' +
      escapeHtml(m.tekst) + meta + '</div>';
  }

  function tekenChat() {
    $('#wChat').innerHTML = gesprek.berichten.map(bubbel).join('');
    scrollChat();
  }

  function scrollChat() {
    const laatste = $('#wChat').lastElementChild;
    if (laatste) laatste.scrollIntoView({ block: 'nearest' });
  }

  function nu() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  $('#wComposer').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#wInput');
    const tekst = input.value.trim();
    if (!tekst) return;
    gesprek.berichten.push({ van: 'ik', tekst: tekst, tijd: nu(), gelezen: true });
    input.value = '';
    tekenChat();
  });

  $('#wPhoto').addEventListener('click', () => {
    gesprek.berichten.push({ van: 'ik', foto: 'ph-beams', tijd: nu(), gelezen: true });
    tekenChat();
    toast('Foto gedeeld in de projectchat');
  });

  $('#wVoice').addEventListener('click', () => toast('Spraakbericht opnemen — houd ingedrukt'));

  /* ---- Start ---------------------------------------------------------------- */

  tekenEntry();
  tekenChat();
  tekenTimer();
  tekenDag();
  toon('vandaag');
})();
