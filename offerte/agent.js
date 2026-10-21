const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const { betaZodTool } = require('@anthropic-ai/sdk/helpers/beta/zod');
const { z } = require('zod');
const { OfferteSchema, berekenTotalen } = require('./schema');

// ---------- De offerte-agent ----------
// Claude bekijkt de foto's en de omschrijving, zoekt zelf prijzen en arbeidsnormen
// op in jouw prijslijst (data/prijslijst.json) en levert de offerte in via de tool
// dien_offerte_in. De server rekent daarna alle totalen en btw zelf uit.

const MODEL = process.env.OFFERTE_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.OFFERTE_EFFORT || 'high';

// Pas aanmaken bij de eerste offerte, zodat de webshop ook zonder ANTHROPIC_API_KEY opstart.
let client;
const getClient = () => (client ??= new Anthropic()); // leest ANTHROPIC_API_KEY uit .env

function leesPrijslijst(bestand) {
  return JSON.parse(fs.readFileSync(bestand, 'utf8'));
}

function normaliseer(tekst) {
  return tekst
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Simpele trefwoord-zoeker: telt per artikel hoeveel zoekwoorden voorkomen in
// naam, categorie en trefwoorden. Ruim genoeg voor een prijslijst van een paar honderd regels.
function zoekInPrijslijst(prijslijst, zoektermen) {
  const resultaten = {};
  for (const term of zoektermen) {
    const woorden = normaliseer(term).split(/\s+/).filter((w) => w.length > 1);
    const score = (tekst) => woorden.filter((w) => tekst.includes(w)).length;

    const artikelen = prijslijst.artikelen
      .map((a) => ({ a, s: score(normaliseer([a.naam, a.categorie, ...(a.trefwoorden || [])].join(' '))) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s)
      .slice(0, 8)
      .map((x) => x.a);

    const normen = (prijslijst.normen_arbeid || [])
      .map((n) => ({ n, s: score(normaliseer(n.werk)) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s)
      .slice(0, 4)
      .map((x) => x.n);

    resultaten[term] = { artikelen, arbeidsnormen: normen };
  }
  return resultaten;
}

function systeemPrompt(prijslijst) {
  return `Je bent de calculator van een Nederlands hoveniers- en timmerbedrijf. Je stelt complete, realistische offertes op voor tuinklussen, timmerwerk, tuinhuizen en overkappingen op basis van foto's en een korte omschrijving van de vakman of de klant.

Werkwijze:
1. Bekijk elke foto zorgvuldig. Beschrijf de huidige situatie: wat moet weg, wat blijft, ondergrond, hoogteverschillen, bereikbaarheid (smalle doorgang? alles door het huis?), aansluitingen op gevel of erfgrens.
2. Schat de maten. Gebruik referenties op de foto: tegels (meestal 30x30 of 60x60 cm), stoeptegels 30x30, klinkers 21x10,5 cm, een deur is ca. 2,1 m hoog, een baksteen ca. 21x5 cm (met voeg ~6,25 cm per laag), een schuttingscherm 180 cm breed, een kliko ca. 1,1 m hoog. Maten in de tekst gaan altijd vóór je eigen schatting.
3. Zoek met zoek_prijslijst de prijzen en arbeidsnormen op van alles wat je nodig hebt. Zoek per onderdeel (bv. ["betonpaal", "onderplaat", "schutting plaatsen", "afvoer"]); je mag de tool meerdere keren aanroepen. Gebruik de prijslijstprijs als die er is (prijsbron "prijslijst" + artikelcode). Staat iets er niet in, schat dan een realistische Nederlandse marktprijs excl. btw (prijsbron "schatting").
4. Bereken de hoeveelheden als een vakman: inclusief zaagverlies (hout ca. 10%, tegels ca. 5%), palen elke 1,8 m plus één, poeren per staander, dakoverstek, beitsen in lagen. Leg de rekensom kort vast in "toelichting".
5. Arbeid: uren = hoeveelheid × arbeidsnorm, afgerond op hele of halve uren, tegen het uurtarief. Reken een realistische ploeggrootte en rond de totale duur af op hele of halve werkdagen. Vergeet geen voorbereiding, sloopwerk, opruimen en afvoer.
6. Neem altijd mee waar van toepassing: voorrijkosten per werkdag, klein materiaal/bevestigingsmiddelen (${prijslijst.tarieven?.klein_materiaal_percentage ?? 5}% van het materiaal, als aparte regel), afvoer van sloopafval of grond, materieelhuur. Gebruik "stelpost" voor onderdelen die je echt niet kunt inschatten zonder inmeten (bv. onbekende fundering).
7. Btw: 21% is het standaard tarief voor tuin- en timmerwerk; gebruik geen 9% tenzij je zeker weet dat het van toepassing is.
8. Rond af met de tool dien_offerte_in en roep die precies één keer aan, met álle regels. Reken zelf geen totalen uit; dat doet het systeem.

Schrijf de werkomschrijving voor de klant (u-vorm, helder, zonder vakjargon waar dat kan). Wees eerlijk over onzekerheid: wat je niet goed op de foto kunt zien, zet je bij aannames en vragen_aan_klant, en geef dat aan in de betrouwbaarheid. Zie je op de foto's iets wat de klus duurder of riskanter maakt (kabels, wortels, verzakking, asbestverdachte golfplaten bij een oud schuurtje), benoem dat.

Vaste tarieven van dit bedrijf (excl. btw):
${JSON.stringify(prijslijst.tarieven, null, 2)}`;
}

function bouwGebruikersbericht({ omschrijving, fotos, plaats }) {
  const content = [];
  fotos.forEach((foto, i) => {
    content.push({ type: 'text', text: `Foto ${i + 1}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: foto.mediaType, data: foto.data } });
  });
  content.push({
    type: 'text',
    text: [
      `Omschrijving van de klus:\n${omschrijving || '(geen omschrijving — baseer je op de foto\'s)'}`,
      plaats ? `Plaats van uitvoering: ${plaats}` : null,
      `Aantal foto's: ${fotos.length}. Stel de volledige offerte op.`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  });
  return content;
}

/**
 * Laat de agent een offerte opstellen.
 * @returns {Promise<{offerte, totalen, gebruik, model}>}
 */
async function stelOfferteOp({ omschrijving, fotos, plaats, prijslijstBestand }) {
  const prijslijst = leesPrijslijst(prijslijstBestand);
  let ingediend = null;

  const zoekPrijslijst = betaZodTool({
    name: 'zoek_prijslijst',
    description:
      'Zoek artikelen (materiaal, materieel) met verkoopprijzen excl. btw en arbeidsnormen (uren per eenheid) in de prijslijst van het bedrijf. Geef één of meer korte zoektermen; per term krijg je de beste treffers terug.',
    inputSchema: z.object({
      zoektermen: z.array(z.string()).describe('bv. ["douglas balk", "epdm", "poer", "overkapping bouwen"]'),
    }),
    run: async ({ zoektermen }) => JSON.stringify(zoekInPrijslijst(prijslijst, zoektermen)),
  });

  const dienOfferteIn = betaZodTool({
    name: 'dien_offerte_in',
    description:
      'Lever de complete offerte in. Roep dit precies één keer aan, als laatste stap, met alle regels. Totalen en btw worden door het systeem berekend.',
    inputSchema: OfferteSchema,
    run: async (offerte) => {
      if (!offerte.regels.length) throw new Error('De offerte bevat geen regels. Voeg alle regels toe en dien opnieuw in.');
      ingediend = offerte;
      const t = berekenTotalen(offerte);
      return `Offerte ontvangen: ${t.regels.length} regels, subtotaal € ${t.subtotaal.toFixed(2)} excl. btw. Sluit af met één korte zin, zonder de offerte te herhalen.`;
    },
  });

  const finalMessage = await getClient().beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT },
    // Als een veiligheidsfilter onterecht weigert, probeert de API het automatisch op een ander model.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: systeemPrompt(prijslijst), cache_control: { type: 'ephemeral' } }],
    tools: [zoekPrijslijst, dienOfferteIn],
    messages: [{ role: 'user', content: bouwGebruikersbericht({ omschrijving, fotos, plaats }) }],
    max_iterations: 15,
  });

  if (finalMessage.stop_reason === 'refusal') {
    throw new AgentFout('De AI weigerde deze aanvraag te verwerken. Pas de omschrijving of foto\'s aan en probeer opnieuw.');
  }
  if (!ingediend) {
    const tekst = finalMessage.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    throw new AgentFout(
      tekst
        ? `De agent heeft geen offerte ingediend. Antwoord van de agent: ${tekst}`
        : 'De agent heeft geen offerte ingediend. Probeer het opnieuw met een iets uitgebreidere omschrijving.'
    );
  }

  return {
    offerte: ingediend,
    totalen: berekenTotalen(ingediend),
    model: finalMessage.model,
  };
}

class AgentFout extends Error {}

module.exports = { stelOfferteOp, zoekInPrijslijst, AgentFout, Anthropic };
