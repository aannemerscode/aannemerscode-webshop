const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { OfferteSchema, KlantSchema, berekenTotalen } = require('./schema');
const { stelOfferteOp, AgentFout, Anthropic } = require('./agent');
const { genereerOffertePdf } = require('./pdf');

// ---------- Offerte-agent: routes en opslag ----------
// Alleen voor jezelf (de vakman): elke aanvraag kost API-tegoed, dus alle
// routes vragen om OFFERTE_TOKEN, die je in .env / Render -> Environment zet.

const MAX_FOTOS = 10;
const TOEGESTANE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function createOfferteRouter({ seller, dataDir }) {
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

  router.use(express.json({ limit: '40mb' }));

  router.use((req, res, next) => {
    const token = process.env.OFFERTE_TOKEN;
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

    const verwerkt = [];
    for (const f of fotos) {
      const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(String(f));
      if (!m || !TOEGESTANE_TYPES.includes(m[1])) {
        return res.status(400).json({ error: "Foto's moeten JPG, PNG, WebP of GIF zijn." });
      }
      verwerkt.push({ mediaType: m[1], data: m[2] });
    }

    try {
      const resultaat = await stelOfferteOp({
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
      return res.status(500).json({ error: 'Er ging iets mis bij het opstellen van de offerte.' });
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

  router.get('/:id/pdf', async (req, res) => {
    const r = leesOffertes()[req.params.id];
    if (!r) return res.status(404).json({ error: 'Niet gevonden' });
    try {
      const pdf = await genereerOffertePdf(r, seller);
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="Offerte-${r.nummer}.pdf"`);
      res.send(pdf);
    } catch (err) {
      console.error('Offerte-PDF fout:', err);
      res.status(500).json({ error: 'Kon de PDF niet maken.' });
    }
  });

  return router;
}

module.exports = { createOfferteRouter };
