'use strict';

/**
 * Projexa — gedeelde bouwstenen voor de app-pagina's.
 */

var App = (function () {
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /** Tekst veilig in HTML zetten. Alles wat een gebruiker typt gaat hierdoorheen. */
  function veilig(waarde) {
    return String(waarde == null ? '' : waarde)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Praat met de API. Gooit een fout met de melding van de server erin. */
  function api(pad, opties) {
    opties = opties || {};
    var instellingen = { method: opties.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (opties.body) {
      instellingen.headers['Content-Type'] = 'application/json';
      instellingen.body = JSON.stringify(opties.body);
    }

    return fetch('/api/app' + pad, instellingen).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) throw new Error(data.fout || 'Er ging iets mis. Probeer het nog eens.');
        return data;
      });
    });
  }

  var meldingTimer;
  function melding(tekst) {
    var el = $('#melding');
    if (!el) return;
    el.textContent = tekst;
    el.classList.add('is-zichtbaar');
    clearTimeout(meldingTimer);
    meldingTimer = setTimeout(function () { el.classList.remove('is-zichtbaar'); }, 3200);
  }

  function toonFout(id, bericht) {
    var el = $(id);
    if (!el) return;
    el.textContent = bericht || '';
    el.hidden = !bericht;
  }

  /** Bedragen zoals we ze in Nederland schrijven. */
  function euro(bedrag) {
    if (bedrag == null || bedrag === '') return '—';
    return '€ ' + Number(bedrag).toLocaleString('nl-NL');
  }

  function tijd(isoTekst) {
    var d = new Date(isoTekst);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  /** "vandaag", "gisteren" of een datum — zoals je het in een chatapp verwacht. */
  function dagLabel(isoTekst) {
    var d = new Date(isoTekst);
    var vandaag = new Date();
    var gisteren = new Date(vandaag.getTime() - 86400000);
    var zelfdeDag = function (a, b) { return a.toDateString() === b.toDateString(); };
    if (zelfdeDag(d, vandaag)) return 'Vandaag';
    if (zelfdeDag(d, gisteren)) return 'Gisteren';
    return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' });
  }

  function initialen(naam) {
    var woorden = String(naam || '?')
      .replace(/^(Bouwbedrijf|Schildersbedrijf|Installatiebedrijf|Timmerwerk|Elektro|Aannemersbedrijf)\s+/i, '')
      .trim().split(/\s+/);
    return ((woorden[0] || '?')[0] + (woorden[1] ? woorden[1][0] : '')).toUpperCase();
  }

  /** Vaste kleur per naam, zodat een bedrijf altijd dezelfde tint houdt. */
  function tint(naam) {
    var som = 0;
    for (var i = 0; i < String(naam).length; i++) som += String(naam).charCodeAt(i);
    return ['a', 'b', 'c'][som % 3];
  }

  /** "2026-02-12" wordt "12 februari 2026". */
  function datumVoluit(datum) {
    var d = new Date(datum + 'T12:00:00');
    if (isNaN(d)) return datum;
    return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function weekdag(datum) {
    var d = new Date(datum + 'T12:00:00');
    if (isNaN(d)) return '';
    return d.toLocaleDateString('nl-NL', { weekday: 'long' });
  }

  /** Rooster met kleine foto's; klikken opent hem groot. */
  function fotoRaster(fotos) {
    if (!fotos || !fotos.length) return '';
    return '<div class="fotos">' + fotos.map(function (f) {
      return '<button class="foto" type="button" data-foto="' + veilig(f.id) + '" ' +
        'aria-label="Foto ' + veilig(f.bestandsnaam || '') + ' groot bekijken">' +
        '<img src="/api/app/fotos/' + encodeURIComponent(f.id) + '" alt="" loading="lazy">' +
      '</button>';
    }).join('') + '</div>';
  }

  /** Foto groot tonen. Sluiten met Escape, met de knop, of naast de foto klikken. */
  function toonFoto(id) {
    var bestaand = $('#fotoweergave');
    if (bestaand) bestaand.remove();

    var vak = document.createElement('div');
    vak.id = 'fotoweergave';
    vak.className = 'fotoweergave';
    vak.innerHTML =
      '<button class="fotoweergave__sluit" type="button" aria-label="Sluiten">&times;</button>' +
      '<img src="/api/app/fotos/' + encodeURIComponent(id) + '" alt="">';

    function sluit() {
      vak.remove();
      document.removeEventListener('keydown', opToets);
    }
    function opToets(e) { if (e.key === 'Escape') sluit(); }

    vak.addEventListener('click', function (e) {
      if (e.target === vak || e.target.closest('.fotoweergave__sluit')) sluit();
    });
    document.addEventListener('keydown', opToets);
    document.body.appendChild(vak);
  }

  /** Verstuurt een formulier met bestanden. FormData zet zelf de juiste header. */
  function apiFormulier(pad, formData) {
    return fetch('/api/app' + pad, { method: 'POST', body: formData, credentials: 'same-origin' })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok) throw new Error(data.fout || 'Er ging iets mis. Probeer het nog eens.');
          return data;
        });
      });
  }

  function uitloggen() {
    return api('/uitloggen', { method: 'POST' }).catch(function () {}).then(function () {
      location.href = '/app/';
    });
  }

  return {
    $: $, $$: $$, veilig: veilig, api: api, melding: melding, toonFout: toonFout,
    euro: euro, tijd: tijd, dagLabel: dagLabel, initialen: initialen, tint: tint,
    datumVoluit: datumVoluit, weekdag: weekdag, fotoRaster: fotoRaster, toonFoto: toonFoto,
    apiFormulier: apiFormulier, uitloggen: uitloggen,
  };
}());
