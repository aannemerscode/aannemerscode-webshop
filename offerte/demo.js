const fs = require('fs');
const { OfferteSchema, berekenTotalen, round2 } = require('./schema');

// ---------- Demo-modus: nagebootste agent ----------
// Zonder ANTHROPIC_API_KEY (of met OFFERTE_DEMO=1) maakt deze module een offerte
// op basis van trefwoorden en maten in de omschrijving, met de echte prijslijst en
// de echte totaalberekening. Foto's worden geteld maar niet bekeken. Zo kun je de
// hele app doorlopen (foto's uploaden, offerte bewerken, PDF) zonder API-kosten.

const getal = (s) => Number(String(s).replace(',', '.'));
const nl = (n) => String(n).replace('.', ',');

function leesMaten(tekst) {
  const vlak = /(\d+(?:[.,]\d+)?)\s*(?:m\s*)?[x×]\s*(\d+(?:[.,]\d+)?)/i.exec(tekst);
  const lengte = /(\d+(?:[.,]\d+)?)\s*(?:m1|m\b|meter)/i.exec(tekst);
  return {
    a: vlak ? getal(vlak[1]) : null,
    b: vlak ? getal(vlak[2]) : null,
    lengte: lengte ? getal(lengte[1]) : null,
  };
}

function maakRegelbouwer(prijslijst) {
  const t = prijslijst.tarieven;
  const art = (code) => prijslijst.artikelen.find((a) => a.code === code);
  return {
    t,
    materiaal(groep, code, aantal, toelichting) {
      const a = art(code);
      return { groep, soort: code.startsWith('HUUR') ? 'materieel' : 'materiaal', omschrijving: a.naam, aantal: round2(aantal), eenheid: a.eenheid,
        prijs_per_eenheid: a.prijs, btw_percentage: 21, prijsbron: 'prijslijst', artikelcode: code, toelichting };
    },
    arbeid(groep, omschrijving, uren, toelichting) {
      return { groep, soort: 'arbeid', omschrijving, aantal: Math.ceil(uren * 2) / 2, eenheid: 'uur',
        prijs_per_eenheid: t.uurtarief_vakman, btw_percentage: 21, prijsbron: 'prijslijst', artikelcode: null, toelichting };
    },
    overig(groep, omschrijving, aantal, eenheid, prijs, toelichting, soort = 'overig', prijsbron = 'prijslijst') {
      return { groep, soort, omschrijving, aantal: round2(aantal), eenheid, prijs_per_eenheid: round2(prijs), btw_percentage: 21,
        prijsbron, artikelcode: null, toelichting };
    },
  };
}

const SCENARIO = {
  schutting(tekst, m, r) {
    const L = m.lengte || 12;
    const velden = Math.ceil(L / 1.84);
    const regels = [];
    const sloop = /oud|eruit|weg|vervang/i.test(tekst);
    if (sloop) regels.push(r.materiaal('Voorbereiding & sloop', 'ARB-SLOOP', L, `${nl(L)} m1 bestaande schutting`));
    regels.push(
      r.materiaal('Schutting', 'SCH-BETON-PAAL', velden + 1, `${velden} velden van 1,84 m + 1 eindpaal`),
      r.materiaal('Schutting', 'SCH-BETON-ONDERPLAAT', velden, `1 per veld`),
      r.materiaal('Schutting', 'HT-DOU-PLANK-28', Math.ceil(velden * 1.84 * 8 * 1.1), `${velden} velden × 8 planken × 1,84 m + 10% zaagverlies`),
    );
    if (/poort/i.test(tekst)) regels.push(r.materiaal('Schutting', 'SCH-POORT', 1, 'op verzoek klant'));
    regels.push(r.arbeid('Schutting', 'Plaatsen hout-betonschutting incl. palen stellen', L * 0.8 + (/poort/i.test(tekst) ? 3 : 0), `${nl(L)} m1 × 0,8 u/m1`));
    if (sloop) regels.push(r.materiaal('Afvoer', 'GRD-AFVOER-GROND', Math.max(1, round2(L * 0.15)), 'sloophout en puin'));
    return { regels, titel: `Hout-betonschutting ${nl(L)} m1`, type: 'tuinklus', dagen: Math.max(1, Math.ceil((L * 0.8) / 16 * 2) / 2), maten: `lengte ca. ${nl(L)} m1, hoogte 180 cm` };
  },
  overkapping(tekst, m, r) {
    const a = m.a || 4, b = m.b || 3, opp = round2(a * b);
    const staanders = a > 4.5 ? 3 : 2;
    const regels = [
      r.materiaal('Fundering', 'FUN-POER-BETON', staanders, `${staanders} staanders aan de voorzijde, achterzijde tegen gevel`),
      r.materiaal('Constructie', 'HT-DOU-BALK-12', staanders * 2.7, `${staanders} staanders × 2,7 m`),
      r.materiaal('Constructie', 'HT-DOU-BALK-7x20', round2(a * 2 + Math.ceil(a / 0.6) * b), `voor- en muurplaat ${nl(a)} m + gordingen h.o.h. 60 cm`),
      r.materiaal('Dak', 'HT-OSB-18', Math.ceil(opp * 1.1), `${nl(opp)} m2 + 10% snijverlies`),
      r.materiaal('Dak', 'DAK-EPDM', Math.ceil(opp * 1.15), `${nl(opp)} m2 + opstand en overlap`),
      r.materiaal('Dak', 'DAK-DAKTRIM', round2(a + b * 2), 'drie vrije zijden'),
      r.materiaal('Dak', 'DAK-GOOT', a, 'goot over de volle breedte'),
      r.arbeid('Constructie', 'Bouwen overkapping (staanders, liggers, dakbeschot)', opp * 2.8, `${nl(opp)} m2 × 2,8 u/m2`),
      r.arbeid('Dak', 'EPDM en daktrim aanbrengen', opp * 0.45, `${nl(opp)} m2 × 0,45 u/m2`),
    ];
    return { regels, titel: `Overkapping ${nl(a)} × ${nl(b)} m met EPDM-dak`, type: 'overkapping', dagen: Math.ceil((opp * 3.25) / 16 * 2) / 2, maten: `${nl(a)} m breed × ${nl(b)} m diep (${nl(opp)} m2)` };
  },
  tuinhuis(tekst, m, r) {
    const a = m.a || 3, b = m.b || 2.5, opp = round2(a * b), omtrek = round2(2 * (a + b));
    const regels = [];
    if (/oud|weg|sloop/i.test(tekst)) {
      regels.push(r.overig('Voorbereiding & sloop', 'Slopen bestaand schuurtje incl. afvoer', 1, 'post', 385, 'ca. 2 × 2 m, houten opstal', 'overig', 'schatting'));
    }
    regels.push(
      r.materiaal('Fundering', 'FUN-STELKOS', Math.ceil(a / 1) * Math.ceil(b / 1.2) , 'raster ca. 1,0 × 1,2 m'),
      r.materiaal('Casco', 'HT-VUR-REGEL-45x145', round2(Math.ceil(a / 0.6) * b * 2), 'vloer- en dakbalken h.o.h. 60 cm'),
      r.materiaal('Casco', 'HT-VUR-REGEL-45', round2(omtrek * 2.3 / 0.6 + omtrek * 2), 'stijlen h.o.h. 60 cm + boven- en onderregels'),
      r.materiaal('Casco', 'HT-OSB-18', Math.ceil(opp * 2 * 1.1), 'vloer en dakbeschot + 10%'),
      r.materiaal('Gevel', 'HT-DOU-RHOMBUS', Math.ceil((omtrek * 2.3) / 0.08 * 1.1), `${round2(omtrek * 2.3)} m2 gevel, latten h.o.h. 8 cm + 10%`),
      r.materiaal('Dak', 'DAK-EPDM', Math.ceil(opp * 1.25), 'incl. overstek en opstand'),
      r.materiaal('Dak', 'DAK-DAKTRIM', omtrek + 1, 'rondom'),
      r.materiaal('Kozijnen', 'TH-KOZIJN-DEUR', 1, 'volgens omschrijving'),
    );
    if (/raam/i.test(tekst)) regels.push(r.materiaal('Kozijnen', 'TH-RAAM', 1, 'volgens omschrijving'));
    regels.push(
      r.arbeid('Casco', 'Bouwen tuinhuis (casco, wanden, dak)', opp * 5.5, `${nl(opp)} m2 vloer × 5,5 u/m2`),
      r.arbeid('Kozijnen', 'Kozijnen stellen en afwerken', /raam/i.test(tekst) ? 6 : 3, '3 u per kozijn'),
    );
    return { regels, titel: `Maatwerk tuinhuis ${nl(a)} × ${nl(b)} m`, type: 'tuinhuis', dagen: Math.ceil((opp * 5.5 + 6) / 16 * 2) / 2, maten: `${nl(a)} × ${nl(b)} m (${nl(opp)} m2 vloer)` };
  },
  terras(tekst, m, r) {
    const a = m.a || 5, b = m.b || 6, opp = round2(a * b), omtrek = round2(2 * (a + b));
    const keramiek = /kerami/i.test(tekst);
    const regels = [
      r.arbeid('Grondwerk', 'Ontgraven en egaliseren', opp * 0.25, `${nl(opp)} m2 × 0,25 u/m2`),
      r.materiaal('Grondwerk', 'GRD-AFVOER-GROND', round2(opp * 0.15), `${nl(opp)} m2 × 15 cm`),
      r.materiaal('Grondwerk', keramiek ? 'BES-SPLIT' : 'BES-ZAND', round2(opp * 0.06), `${nl(opp)} m2 × 6 cm`),
      r.materiaal('Bestrating', keramiek ? 'BES-KERAMIEK-6060' : 'BES-TEGEL-6060', Math.ceil(opp * 1.05), `${nl(opp)} m2 + 5% snijverlies`),
      r.materiaal('Bestrating', 'BES-OPSLUITBAND', omtrek, 'rondom'),
      r.arbeid('Bestrating', keramiek ? 'Keramische tegels leggen op split' : 'Tegels leggen incl. zandbed', opp * (keramiek ? 0.9 : 0.55), `${nl(opp)} m2 × ${keramiek ? '0,9' : '0,55'} u/m2`),
      r.materiaal('Materieel', 'HUUR-TRILPLAAT', 1, '1 dag'),
    ];
    return { regels, titel: `${keramiek ? 'Keramisch terras' : 'Terras'} ${nl(a)} × ${nl(b)} m`, type: 'tuinklus', dagen: Math.ceil((opp * (keramiek ? 1.15 : 0.8)) / 16 * 2) / 2, maten: `${nl(a)} × ${nl(b)} m (${nl(opp)} m2)` };
  },
};

function kiesScenario(tekst) {
  if (/overkap|veranda|carport|pergola/i.test(tekst)) return 'overkapping';
  if (/tuinhuis|schuur|blokhut|berging/i.test(tekst)) return 'tuinhuis';
  if (/schutting|erfafscheiding|scherm/i.test(tekst)) return 'schutting';
  return 'terras';
}

async function stelDemoOfferteOp({ omschrijving, fotos, prijslijstBestand }) {
  const prijslijst = JSON.parse(fs.readFileSync(prijslijstBestand, 'utf8'));
  const r = maakRegelbouwer(prijslijst);
  const tekst = omschrijving || '';
  const soort = kiesScenario(tekst);
  const maten = leesMaten(tekst);

  const info = SCENARIO[soort](tekst, maten, r);
  const regels = info.regels;

  const dagen = Math.max(1, info.dagen);
  const materiaalTotaal = regels.filter((x) => x.soort === 'materiaal').reduce((s, x) => s + x.aantal * x.prijs_per_eenheid, 0);
  regels.push(
    r.overig('Algemeen', 'Klein materiaal en bevestigingsmiddelen', 1, 'post', materiaalTotaal * (r.t.klein_materiaal_percentage / 100), `${r.t.klein_materiaal_percentage}% van het materiaal`),
    r.overig('Algemeen', 'Voorrijkosten', dagen, 'dag', r.t.voorrijkosten_per_dag, `${dagen} werkdag(en)`),
  );

  // Even "nadenken", zodat de voortgangsweergave in de app te zien is.
  await new Promise((res) => setTimeout(res, 2500));

  const offerte = OfferteSchema.parse({
    titel: info.titel,
    type_klus: info.type,
    fotoanalyse: `DEMO-MODUS: de ${fotos.length} foto('s) zijn ontvangen maar niet echt bekeken. Deze offerte is opgebouwd uit trefwoorden en maten in de omschrijving (${info.maten}). Zet ANTHROPIC_API_KEY in .env voor een echte analyse door de AI.`,
    werkomschrijving: `Wij voeren voor u de volgende werkzaamheden uit:\n\n1. Werkplek inrichten en de bestaande situatie beschermen.\n2. ${info.titel} volgens de specificatie hieronder.\n3. Netjes opruimen en het afval afvoeren.\n\nAlle materialen zijn van goede kwaliteit en worden vakkundig verwerkt.`,
    regels,
    aannames: [`Maten: ${info.maten}`, 'Werkplek is bereikbaar met kruiwagen via een doorgang van minimaal 80 cm', 'Ondergrond is draagkrachtig en vrij van kabels en leidingen'],
    uitsluitingen: ['Elektra en verlichting', 'Herstel van beplanting buiten het werkgebied', 'Eventuele leges voor een omgevingsvergunning'],
    vragen_aan_klant: ['Maten ter plekke controleren', 'Liggen er kabels of leidingen in het werkgebied?'],
    vergunning_advies: 'In het achtererfgebied is dit vaak vergunningsvrij. Controleer het altijd via de vergunningcheck op het Omgevingsloket.',
    uitvoering: { werkdagen: dagen, aantal_personen: 2 },
    betrouwbaarheid: 'laag',
    betrouwbaarheid_toelichting: "Demo: foto's niet geanalyseerd, maten uit de omschrijving of standaardwaarden.",
  });

  return { offerte, totalen: berekenTotalen(offerte), model: 'demo' };
}

// ---------- Demo-visualisatie ----------
// Bouwt een nette werktekening uit het soort klus en de maten in de titel; de schets op de
// foto is in demo-modus een vaste markering, omdat de foto niet echt bekeken wordt.
const P = (x, y) => ({ x: round2(x), y: round2(y) });
const rechthoek = (x1, y1, x2, y2) => [P(x1, y1), P(x2, y1), P(x2, y2), P(x1, y2)];
const vlak = (punten, materiaal, label = null) => ({ type: 'vlak', punten, materiaal, label });
const lijn = (punten, materiaal, label = null) => ({ type: 'lijn', punten, materiaal, label });
const maat = (a, b, waarde) => ({ type: 'maatlijn', punten: [a, b], materiaal: 'bestaand', label: `${nl(round2(waarde).toFixed(2))} m` });
const tekst = (p, label) => ({ type: 'tekst', punten: [p], materiaal: 'bestaand', label });

const TEKENING = {
  overkapping(m) {
    const a = m.a || 4, b = m.b || 3, h = 2.5;
    const n = a > 4.5 ? 3 : 2;
    const xs = Array.from({ length: n }, (_, i) => 0.05 + (i * (a - 0.22)) / (n - 1));
    const gordingen = Array.from({ length: Math.floor(a / 0.6) + 1 }, (_, i) => Math.min(a, i * 0.6));
    return {
      boven: { breedte_m: a, hoogte_m: b, elementen: [
        lijn([P(-0.6, 0), P(a + 0.6, 0)], 'bestaand', 'achtergevel'),
        vlak(rechthoek(0, 0, a, b), 'dak'),
        ...gordingen.map((x) => lijn([P(x, 0.05), P(x, b - 0.05)], 'hout')),
        lijn([P(0, b - 0.1), P(a, b - 0.1)], 'hout'),
        ...xs.map((x) => vlak(rechthoek(x, b - 0.17, x + 0.12, b - 0.05), 'hout')),
        maat(P(0, b + 0.5), P(a, b + 0.5), a), maat(P(a + 0.5, 0), P(a + 0.5, b), b),
        tekst(P(a / 2, b / 2), 'EPDM-dak'),
      ] },
      voor: { breedte_m: a, hoogte_m: h + 0.25, elementen: [
        vlak(rechthoek(-0.6, 0, -0.05, h + 0.6), 'bestaand', 'gevel'),
        ...xs.map((x) => vlak(rechthoek(x, 0, x + 0.12, h), 'hout')),
        vlak(rechthoek(-0.05, h, a + 0.1, h + 0.25), 'dak'),
        lijn([P(a - 0.1, h), P(a - 0.1, 0.05)], 'staal', 'hwa'),
        maat(P(a + 0.6, 0), P(a + 0.6, h + 0.25), h + 0.25), maat(P(0, -0.45), P(a, -0.45), a),
        tekst(P(a / 2, h / 2), 'douglas staanders 12×12'),
      ] },
      foto: 'dak',
    };
  },
  schutting(m) {
    const L = m.lengte || 12, velden = Math.ceil(L / 1.84), w = L / velden;
    const xs = Array.from({ length: velden + 1 }, (_, i) => i * w);
    return {
      boven: { breedte_m: L, hoogte_m: 0.6, elementen: [
        lijn([P(0, 0.05), P(L, 0.05)], 'hout'),
        ...xs.map((x) => vlak(rechthoek(x - 0.05, 0, x + 0.05, 0.1), 'beton')),
        maat(P(0, 0.6), P(L, 0.6), L), tekst(P(L / 2, -0.35), 'erfgrens'),
      ] },
      voor: { breedte_m: L, hoogte_m: 1.8, elementen: [
        ...xs.slice(0, -1).flatMap((x) => [
          vlak(rechthoek(x + 0.05, 0, x + w - 0.05, 0.26), 'beton'),
          vlak(rechthoek(x + 0.05, 0.26, x + w - 0.05, 1.8), 'hout'),
          ...[0.45, 0.65, 0.85, 1.05, 1.25, 1.45, 1.65].map((y) => lijn([P(x + 0.05, y), P(x + w - 0.05, y)], 'hout')),
        ]),
        ...xs.map((x) => vlak(rechthoek(x - 0.05, 0, x + 0.05, 1.85), 'beton')),
        maat(P(-0.5, 0), P(-0.5, 1.8), 1.8), maat(P(0, -0.4), P(w, -0.4), w),
        tekst(P(L / 2, 2.15), `${velden} velden hout-beton`),
      ] },
      foto: 'hout',
    };
  },
  tuinhuis(m) {
    const a = m.a || 3, b = m.b || 2.5, h = 2.3, d = 0.1;
    return {
      boven: { breedte_m: a, hoogte_m: b, elementen: [
        vlak(rechthoek(0, 0, a, d), 'hout'), vlak(rechthoek(0, b - d, a * 0.2, b), 'hout'),
        vlak(rechthoek(a * 0.2 + 0.9, b - d, a, b), 'hout'),
        vlak(rechthoek(0, 0, d, b), 'hout'), vlak(rechthoek(a - d, 0, a, b), 'hout'),
        lijn([P(a * 0.2, b), P(a * 0.2 + 0.6, b + 0.6)], 'hout', 'deur'),
        maat(P(0, b + 0.9), P(a, b + 0.9), a), maat(P(a + 0.5, 0), P(a + 0.5, b), b),
        tekst(P(a / 2, b / 2), `${nl(round2(a * b))} m² vloer`),
      ] },
      voor: { breedte_m: a, hoogte_m: h + 0.15, elementen: [
        vlak(rechthoek(0, 0, a, h), 'hout'),
        ...Array.from({ length: Math.floor(a / 0.25) }, (_, i) => lijn([P(0.12 + i * 0.25, 0.05), P(0.12 + i * 0.25, h - 0.05)], 'hout')),
        vlak(rechthoek(-0.15, h, a + 0.15, h + 0.15), 'dak'),
        vlak(rechthoek(a * 0.2, 0, a * 0.2 + 0.9, 2.05), 'staal', 'deur'),
        vlak(rechthoek(a * 0.6, 1.05, a * 0.6 + 0.6, 1.95), 'glas', 'raam'),
        maat(P(a + 0.5, 0), P(a + 0.5, h + 0.15), h + 0.15), maat(P(0, -0.4), P(a, -0.4), a),
      ] },
      foto: 'hout',
    };
  },
  terras(m) {
    const a = m.a || 5, b = m.b || 6;
    return {
      boven: { breedte_m: a, hoogte_m: b, elementen: [
        vlak(rechthoek(0, 0, a, b), 'tegels'),
        lijn([P(0, 0), P(a, 0), P(a, b), P(0, b), P(0, 0)], 'beton', 'opsluitband'),
        maat(P(0, b + 0.5), P(a, b + 0.5), a), maat(P(a + 0.5, 0), P(a + 0.5, b), b),
        tekst(P(a / 2, b / 2), 'tegels 60×60'),
      ] },
      voor: { breedte_m: a, hoogte_m: 0.4, elementen: [
        vlak(rechthoek(0, -0.12, a, 0), 'grond', 'zandbed / split'),
        vlak(rechthoek(0, 0, a, 0.04), 'tegels'),
        vlak(rechthoek(-0.06, -0.2, 0, 0.06), 'beton'), vlak(rechthoek(a, -0.2, a + 0.06, 0.06), 'beton'),
        maat(P(0, 0.35), P(a, 0.35), a), tekst(P(a / 2, -0.35), 'doorsnede terras'),
      ] },
      foto: 'tegels',
    };
  },
};

function maakDemoVisualisatie(offerte, aantalFotos) {
  const soort = { overkapping: 'overkapping', tuinhuis: 'tuinhuis' }[offerte.type_klus] || kiesScenario(offerte.titel);
  const t = TEKENING[soort](leesMaten(offerte.titel));
  const fotoschets = aantalFotos
    ? {
        foto: 1,
        elementen: [
          vlak([P(280, 560), P(720, 560), P(800, 820), P(200, 820)], t.foto),
          tekst(P(500, 500), `Demo: hier komt ${offerte.titel.toLowerCase()}`),
        ],
        toelichting: 'Demo-modus: een vaste markering op de eerste foto. Met de echte AI wordt het nieuwe werk in perspectief op de juiste plek getekend.',
      }
    : { foto: null, elementen: [], toelichting: "Geen foto's beschikbaar; alleen de werktekening is gemaakt." };
  return { bovenaanzicht: t.boven, vooraanzicht: t.voor, fotoschets };
}

module.exports = { stelDemoOfferteOp, maakDemoVisualisatie, kiesScenario, leesMaten };
