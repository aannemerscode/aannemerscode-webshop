const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { OfferteSchema, KlantSchema, berekenTotalen } = require('./schema');
const { stelOfferteOp, maakVisualisatie, AgentFout, Anthropic } = require('./agent');
const { stelDemoOfferteOp, maakDemoVisualisatie } = require('./demo');

// ---------- GreenTeam (offerte-agent): routes en opslag ----------
// Alleen voor jezelf (de vakman): elke aanvraag kost API-tegoed, dus alle
// routes vragen om OFFERTE_TOKEN, die je in .env / Render -> Environment zet.
// Zonder ANTHROPIC_API_KEY (of met OFFERTE_DEMO=1) draait de demo-modus: de agent
// wordt nagebootst, er zijn geen kosten en een toegangscode is dan optioneel.

const MAX_FOTOS = 10;
const TOEGESTANE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Foto's komen binnen als data-URL's; geeft null terug als er een ongeldige tussen zit.
function leesFotos(fotos) {
  const verwerkt = [];
  for (const f of fotos) {
    const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(String(f));
    if (!m || !TOEGESTANE_TYPES.includes(m[1])) return null;
    verwerkt.push({ mediaType: m[1], data: m[2] });
  }
  return verwerkt;
}

function stuurAgentFout(res, err, wat) {
  if (err instanceof AgentFout) return res.status(422).json({ error: err.message });
  if (err instanceof Anthropic.AuthenticationError) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY ontbreekt of is ongeldig.' });
  }
  if (err instanceof Anthropic.RateLimitError) {
    return res.status(429).json({ error: 'Te veel aanvragen tegelijk bij de AI — probeer het over een minuut opnieuw.' });
  }
  if (err instanceof Anthropic.APIError) {
    console.error('Offerte-agent API-fout:', err.status, err.message);
    return res.status(502).json({ error: `De AI-dienst gaf een fout (${err.status ?? 'verbinding'}). Probeer het opnieuw.` });
  }
  console.error('Offerte-agent fout:', err);
  return res.status(500).json({ error: `Er ging iets mis bij het maken van de ${wat}.` });
}

// Bedrijfsgegevens die op de offerte (PDF) komen. Los van de webshop-gegevens (SELLER_*).
function bedrijfUitEnv() {
  const e = process.env;
  return {
    naam: e.OFFERTE_BEDRIJF_NAAM || 'GreenTeam',
    slogan: e.OFFERTE_BEDRIJF_SLOGAN || 'Hoveniers · Tuinhuizen · Overkappingen',
    adres: e.OFFERTE_BEDRIJF_ADRES || '',
    postcode_plaats: e.OFFERTE_BEDRIJF_POSTCODE_PLAATS || '',
    telefoon: e.OFFERTE_BEDRIJF_TELEFOON || '',
    email: e.OFFERTE_BEDRIJF_EMAIL || '',
    website: e.OFFERTE_BEDRIJF_WEBSITE || '',
    kvk: e.OFFERTE_BEDRIJF_KVK || '',
    btw: e.OFFERTE_BEDRIJF_BTW || '',
    iban: e.OFFERTE_BEDRIJF_IBAN || '',
  };
}

function createOfferteRouter({ dataDir }) {
  const router = express.Router();
  const OFFERTES_FILE = path.join(dataDir, 'offertes.json');
  const COUNTER_FILE = path.join(dataDir, 'offerte-counter.json');
  // Prijslijst staat standaard in de repo (data/), maar kan op de persistent disk overschreven worden.
  const PRIJSLIJST_FILE = fs.existsSync(path.join(dataDir, 'prijslijst.json'))
    ? path.join(dataDir, 'prijslijst.json')
    : path.join(__dirname, '..', 'data', 'prijslijst.json');

  const leesOffertes = () => {
    try {
      return JSON.parse(fs.readFileSync(OFFERTES_FILE, 'utf8'));
    } catch {
      return {};
    }
  };
  const schrijfOffertes = (o) => fs.writeFileSync(OFFERTES_FILE, JSON.stringify(o, null, 2));

  // Doorlopend offertenummer per jaar: OFF-2026-0001, ... (zelfde aanpak als de factuurteller)
  function volgendNummer() {
    const jaar = new Date().getFullYear();
    let c;
    try {
      c = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8'));
    } catch {
      c = { year: jaar, next: 1 };
    }
    if (c.year !== jaar) c = { year: jaar, next: 1 };
    const nummer = `OFF-${jaar}-${String(c.next).padStart(4, '0')}`;
    c.next += 1;
    fs.writeFileSync(COUNTER_FILE, JSON.stringify(c));
    return nummer;
  }

  const isDemo = () => process.env.OFFERTE_DEMO === '1' || !process.env.ANTHROPIC_API_KEY;

  router.use(express.json({ limit: '40mb' }));

  // Zonder toegangscode: vertelt de pagina welke modus actief is.
  router.get('/status', (req, res) => {
    res.json({ demo: isDemo(), tokenNodig: Boolean(process.env.OFFERTE_TOKEN) || !isDemo(), bedrijf: bedrijfUitEnv() });
  });

  router.use((req, res, next) => {
    const token = process.env.OFFERTE_TOKEN;
    if (!token && isDemo()) return next();
    if (!token) {
      return res.status(503).json({ error: 'De offerte-agent staat uit: zet OFFERTE_TOKEN in je .env.' });
    }
    const gegeven = Buffer.from(String(req.get('x-offerte-token') || ''));
    const verwacht = Buffer.from(token);
    if (gegeven.length !== verwacht.length || !crypto.timingSafeEqual(gegeven, verwacht)) {
      return res.status(401).json({ error: 'Onjuiste toegangscode.' });
    }
    next();
  });

  // Nieuwe offerte laten opstellen door de agent
  router.post('/', async (req, res) => {
    const { omschrijving = '', plaats = '', fotos = [] } = req.body || {};
    const klant = KlantSchema.safeParse(req.body?.klant || {});
    if (!klant.success) return res.status(400).json({ error: 'Ongeldige klantgegevens.' });
    if (!Array.isArray(fotos) || (!fotos.length && !omschrijving.trim())) {
      return res.status(400).json({ error: "Voeg minimaal één foto of een omschrijving toe." });
    }
    if (fotos.length > MAX_FOTOS) {
      return res.status(400).json({ error: `Maximaal ${MAX_FOTOS} foto's per offerte.` });
    }

    const verwerkt = leesFotos(fotos);
    if (!verwerkt) return res.status(400).json({ error: "Foto's moeten JPG, PNG, WebP of GIF zijn." });

    try {
      const resultaat = await (isDemo() ? stelDemoOfferteOp : stelOfferteOp)({
        omschrijving: String(omschrijving).slice(0, 5000),
        plaats: String(plaats).slice(0, 200),
        fotos: verwerkt,
        prijslijstBestand: PRIJSLIJST_FILE,
      });

      const id = crypto.randomUUID();
      const record = {
        id,
        nummer: volgendNummer(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        klant: klant.data,
        invoer: { omschrijving, plaats, aantalFotos: verwerkt.length },
        model: resultaat.model,
        offerte: resultaat.offerte,
        totalen: resultaat.totalen,
      };
      const alle = leesOffertes();
      alle[id] = record;
      schrijfOffertes(alle);
      return res.json(record);
    } catch (err) {
      return stuurAgentFout(res, err, 'offerte');
    }
  });

  // Werktekening + schets op een foto. De foto's stuurt de pagina opnieuw mee (ze worden niet
  // bij de offerte bewaard); de gekozen foto wordt wel bij de visualisatie opgeslagen.
  router.post('/:id/visualisatie', async (req, res) => {
    const record = leesOffertes()[req.params.id];
    if (!record) return res.status(404).json({ error: 'Niet gevonden' });
    const fotos = Array.isArray(req.body?.fotos) ? req.body.fotos.slice(0, MAX_FOTOS) : [];
    const verwerkt = leesFotos(fotos);
    if (!verwerkt) return res.status(400).json({ error: "Foto's moeten JPG, PNG, WebP of GIF zijn." });
    try {
      const vis = isDemo()
        ? maakDemoVisualisatie(record.offerte, verwerkt.length)
        : await maakVisualisatie({ offerte: record.offerte, fotos: verwerkt });
      const nr = vis.fotoschets.foto;
      const alle = leesOffertes();
      const actueel = alle[req.params.id];
      actueel.visualisatie = {
        ...vis,
        fotoData: nr && fotos[nr - 1] ? String(fotos[nr - 1]) : null,
        createdAt: new Date().toISOString(),
      };
      actueel.updatedAt = new Date().toISOString();
      schrijfOffertes(alle);
      return res.json(actueel);
    } catch (err) {
      return stuurAgentFout(res, err, 'visualisatie');
    }
  });

  // Overzicht van eerdere offertes
  router.get('/', (req, res) => {
    const lijst = Object.values(leesOffertes())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({
        id: r.id,
        nummer: r.nummer,
        titel: r.offerte.titel,
        klant: r.klant.naam,
        totaal: r.totalen.totaal,
        createdAt: r.createdAt,
      }));
    res.json(lijst);
  });

  router.get('/:id', (req, res) => {
    const r = leesOffertes()[req.params.id];
    if (!r) return res.status(404).json({ error: 'Niet gevonden' });
    res.json(r);
  });

  // Aanpassingen uit de editor opslaan (regels, teksten, klantgegevens)
  router.put('/:id', (req, res) => {
    const alle = leesOffertes();
    const r = alle[req.params.id];
    if (!r) return res.status(404).json({ error: 'Niet gevonden' });
    const offerte = OfferteSchema.safeParse(req.body?.offerte);
    const klant = KlantSchema.safeParse(req.body?.klant || r.klant);
    if (!offerte.success || !klant.success) {
      return res.status(400).json({ error: 'De aangepaste offerte is niet geldig.', details: offerte.error?.issues });
    }
    r.offerte = offerte.data;
    r.klant = klant.data;
    r.totalen = berekenTotalen(offerte.data);
    r.updatedAt = new Date().toISOString();
    schrijfOffertes(alle);
    res.json(r);
  });

  return router;
}

module.exports = { createOfferteRouter };
