/* ==========================================================================
   Projexa — bouwt demo.html: alle drie de pagina's in één zelfstandig bestand
   dat je kunt doorklikken zonder server, map of losse bestanden.

   Gebruik:  node build-demo.js
   ========================================================================== */

const fs = require('fs');
const path = require('path');

const dir = __dirname;
const lees = f => fs.readFileSync(path.join(dir, f), 'utf8');

/* ---- CSS: body-selectors omzetten naar klassen, zodat de drie pagina's
        naast elkaar in één document kunnen staan ------------------------- */

const css = [
  lees('assets/base.css'),
  lees('assets/start.css').replace(/^\.start\b/gm, '.startpg').replace(/\n\.start /g, '\n.startpg '),
  lees('assets/brief.css').replace(/body\.brief\b/g, '.brief'),
  lees('assets/app.css'),
  lees('assets/mobiel.css').replace(/body\.mob\b/g, '.mob')
].join('\n\n');

/* ---- HTML: body-inhoud van elke pagina uitpakken --------------------- */

const SPRITE = /<svg width="0" height="0"[\s\S]*?\n<\/svg>\n/;

function body(file) {
  const html = lees(file);
  return html.slice(html.indexOf('>', html.indexOf('<body')) + 1, html.indexOf('</body>'));
}

function zonderScripts(s) {
  return s.replace(/<script src="[^"]*"><\/script>\s*/g, '')
          .replace(/<div class="toast" id="toast"[\s\S]*?<\/div>\s*/, '');
}

function symbool(bron, id) {
  const m = bron.match(new RegExp('<symbol id="' + id + '"[\\s\\S]*?</symbol>'));
  if (!m) throw new Error('symbool ' + id + ' niet gevonden');
  return '    ' + m[0] + '\n';
}

const startBody  = body('start.html');
const formatBody = body('index.html');
const webBody    = body('app.html');
const werkBody   = body('medewerker.html');
const mobBody    = body('mobiel.html');

// Eén gedeelde iconenset: die van het format, aangevuld met de twee iconen
// die alleen in de app en de smartphone-versie voorkomen.
let sprite = formatBody.match(SPRITE)[0];
sprite = sprite.replace('  </g>', symbool(webBody, 'i-phone') + symbool(mobBody, 'i-grid') + '  </g>');

const paginas = {
  start:      startBody.replace(SPRITE, ''),
  web:        zonderScripts(webBody.replace(SPRITE, '')),
  medewerker: zonderScripts(werkBody.replace(SPRITE, '').replace(/<p class="m-desk-note">[\s\S]*?<\/p>\s*/, '')),
  klant:      zonderScripts(mobBody.replace(SPRITE, '').replace(/<p class="m-desk-note">[\s\S]*?<\/p>\s*/, '')),
  format:     formatBody.replace(SPRITE, '').replace(/<header class="site-header">[\s\S]*?<\/header>\s*/, '')
};

// Verwijzingen tussen de pagina's worden knoppen in de wisselbalk.
for (const k of Object.keys(paginas)) {
  paginas[k] = paginas[k]
    .replace(/href="index\.html"/g, 'data-page="format"')
    .replace(/href="start\.html"/g, 'data-page="start"')
    .replace(/href="app\.html"/g, 'data-page="web"')
    .replace(/href="medewerker\.html"/g, 'data-page="medewerker"')
    .replace(/href="mobiel\.html"/g, 'data-page="klant"');
}

/* ---- Wisselbalk ------------------------------------------------------- */

const logo = `<span class="logo">
      <svg class="logo__mark" width="26" height="29" viewBox="0 0 72 80" aria-hidden="true">
        <path fill="#fff" d="M20 2h18a21 21 0 0 1 0 42h-8V32h8a9 9 0 0 0 0-18h-6v64H20z"/>
        <path fill="url(#goldgrad)" d="M4 78V46l18-20v32z"/>
        <path fill="url(#goldgrad)" d="M28 78V54l10-11v35z" opacity=".85"/>
      </svg>
      <span class="logo__type">
        <span class="logo__name">PROJEX<b>A</b></span>
        <span class="logo__tag">PLAN. BOUW. BEHEER.</span>
      </span>
    </span>`;

const demoCss = `
/* ---- Wisselbalk van de demo ------------------------------------------- */
.demo-bar {
  position: sticky;
  top: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 10px 20px;
  background: rgba(9, 11, 12, .93);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, .09);
}

.demo-bar .logo { font-size: 14px; gap: 9px; }

.demo-switch {
  margin-left: auto;
  display: flex;
  gap: 3px;
  padding: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, .07);
  border: 1px solid rgba(255, 255, 255, .1);
}

.demo-switch button {
  border: 0;
  background: none;
  color: rgba(255, 255, 255, .68);
  font-size: 13px;
  font-weight: 600;
  padding: 8px 16px;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
}

.demo-switch button:hover { color: #fff; }

.demo-switch button[aria-current="page"] {
  background: linear-gradient(180deg, var(--gold-light), var(--gold));
  color: #221b0c;
}

.demo-page[hidden] { display: none; }
[data-page] { cursor: pointer; }

.demo-hint {
  font-size: 12.5px;
  color: rgba(255, 255, 255, .4);
  padding: 0 20px 0 0;
}

@media (max-width: 760px) {
  .demo-bar { padding: 9px 12px; gap: 10px; flex-wrap: nowrap; }
  .demo-bar .logo__type, .demo-hint { display: none; }
  .demo-switch {
    margin-left: 0;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    justify-content: flex-start;
    scrollbar-width: none;
  }
  .demo-switch::-webkit-scrollbar { display: none; }
  .demo-switch button { padding: 7px 13px; font-size: 12.5px; }
}
`;

const demoJs = `
/* ---- Wisselen tussen de drie pagina's --------------------------------- */
(function () {
  var titels = {
    start: 'Projexa — Inloggen',
    web: 'Projexa — Aannemer',
    medewerker: 'Projexa — Medewerker',
    klant: 'Projexa — Klantportaal',
    format: 'Projexa — Het ontwerp'
  };

  function ga(pagina) {
    if (!titels[pagina]) pagina = 'start';
    Object.keys(titels).forEach(function (p) {
      document.getElementById('page-' + p).hidden = p !== pagina;
      var knop = document.querySelector('.demo-switch button[data-page="' + p + '"]');
      if (p === pagina) knop.setAttribute('aria-current', 'page');
      else knop.removeAttribute('aria-current');
    });
    document.title = titels[pagina];
    window.scrollTo({ top: 0 });
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-page]');
    if (!el) return;
    e.preventDefault();
    ga(el.dataset.page);
  });

  ga('start');
})();
`;

const inhoud = `<title>Projexa — Plan. Bouw. Beheer.</title>
<style>
${css}
${demoCss}</style>

${sprite}
<header class="demo-bar">
  ${logo}
  <span class="demo-hint">Loop de demo door — alles werkt echt</span>
  <nav class="demo-switch" aria-label="Kies een rol">
    <button type="button" data-page="start" aria-current="page">Start</button>
    <button type="button" data-page="web">Aannemer</button>
    <button type="button" data-page="medewerker">Medewerker</button>
    <button type="button" data-page="klant">Klant</button>
    <button type="button" data-page="format">Het ontwerp</button>
  </nav>
</header>

<section class="demo-page startpg" id="page-start">${paginas.start}</section>

<section class="demo-page app" id="page-web" hidden>${paginas.web}</section>

<section class="demo-page mob" id="page-medewerker" hidden>${paginas.medewerker}</section>

<section class="demo-page mob" id="page-klant" hidden>${paginas.klant}</section>

<section class="demo-page brief" id="page-format" hidden>${paginas.format}</section>

<div class="toast" id="toast" role="status" aria-live="polite"></div>

<script>
${lees('assets/data.js')}
${lees('assets/app.js')}
${lees('assets/medewerker.js')}
${lees('assets/mobiel.js')}
${demoJs}</script>
`;

// 1. Losstaand bestand om lokaal te openen.
const kop = inhoud.slice(0, inhoud.indexOf('</style>') + 9);
const romp = inhoud.slice(inhoud.indexOf('</style>') + 9);

fs.writeFileSync(path.join(dir, 'demo.html'),
  '<!doctype html>\n<html lang="nl">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  '<meta name="theme-color" content="#090b0c">\n' +
  '<link rel="icon" href="data:image/svg+xml,' +
  encodeURIComponent(lees('assets/favicon.svg')).replace(/'/g, '%27').replace(/"/g, '%22') + '">\n' +
  kop + '\n</head>\n<body>\n' + romp + '</body>\n</html>\n');

// 2. Losse inhoud (zonder <html>/<head>/<body>) om te publiceren.
const uit = process.argv[2];
if (uit) fs.writeFileSync(uit, inhoud);

console.log('demo.html geschreven' + (uit ? ' + ' + uit : ''));
