/* ==========================================================================
   Projexa — bouwt demo.html: het inlogscherm en de drie rol-apps in één
   zelfstandig bestand dat je kunt doorklikken zonder server of losse mappen.
   Wisselen van rol gaat via inloggen en uitloggen, net als in de echte app.

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
const webBody    = body('app.html');
const werkBody   = body('medewerker.html');
const mobBody    = body('mobiel.html');

// Eén gedeelde iconenset, aangevuld met het icoon dat alleen in de
// smartphone-versie voorkomt.
let sprite = webBody.match(SPRITE)[0];
sprite = sprite.replace('  </g>', symbool(mobBody, 'i-grid') + '  </g>');

const paginas = {
  start:      startBody.replace(SPRITE, ''),
  web:        zonderScripts(webBody.replace(SPRITE, '')),
  medewerker: zonderScripts(werkBody.replace(SPRITE, '').replace(/<p class="m-desk-note">[\s\S]*?<\/p>\s*/, '')),
  klant:      zonderScripts(mobBody.replace(SPRITE, '').replace(/<p class="m-desk-note">[\s\S]*?<\/p>\s*/, ''))
};

// Verwijzingen tussen de pagina's worden knoppen in de wisselbalk.
for (const k of Object.keys(paginas)) {
  paginas[k] = paginas[k]
    .replace(/href="start\.html"/g, 'data-page="start"')
    .replace(/href="app\.html"/g, 'data-page="web"')
    .replace(/href="medewerker\.html"/g, 'data-page="medewerker"')
    .replace(/href="mobiel\.html"/g, 'data-page="klant"');
}

/* ---- Wisselbalk ------------------------------------------------------- */

const demoCss = `
.demo-page[hidden] { display: none; }
[data-page] { cursor: pointer; }
`;

const demoJs = `
/* ---- Wisselen tussen de rollen (via inloggen en uitloggen) ------------- */
(function () {
  var titels = {
    start: 'Projexa',
    web: 'Projexa — Aannemer',
    medewerker: 'Projexa — Medewerker',
    klant: 'Projexa — Klantportaal'
  };

  function ga(pagina) {
    if (!titels[pagina]) pagina = 'start';
    Object.keys(titels).forEach(function (p) {
      document.getElementById('page-' + p).hidden = p !== pagina;
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
<section class="demo-page startpg" id="page-start">${paginas.start}</section>

<section class="demo-page app" id="page-web" hidden>${paginas.web}</section>

<section class="demo-page mob" id="page-medewerker" hidden>${paginas.medewerker}</section>

<section class="demo-page mob" id="page-klant" hidden>${paginas.klant}</section>

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
