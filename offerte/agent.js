const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const { betaZodTool, betaZodOutputFormat } = require('@anthropic-ai/sdk/helpers/beta/zod');
const { z } = require('zod');
const { OfferteSchema, VisualisatieSchema, berekenTotalen } = require('./schema');

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

// ---------- Visualisatie ----------
// Zelfde instructie als in public/greenteam.html (Claude-modus); houd die twee gelijk.
function visualisatiePrompt(offerte, aantalFotos) {
  const kern = {
    titel: offerte.titel,
    type_klus: offerte.type_klus,
    fotoanalyse: offerte.fotoanalyse,
    werkomschrijving: offerte.werkomschrijving,
    regels: offerte.regels.map((r) => ({ groep: r.groep, omschrijving: r.omschrijving, aantal: r.aantal, eenheid: r.eenheid, toelichting: r.toelichting })),
    aannames: offerte.aannames,
  };
  return `Maak een visualisatie bij deze offerte voor een tuinklus: (1) een werktekening met bovenaanzicht en vooraanzicht op schaal, (2) een schets van het nieuwe werk over een van de foto's.

Werktekening
- Coördinaten in meters. Bovenaanzicht: x naar rechts, y naar beneden (van achter naar voor), oorsprong linksboven. Vooraanzicht: x naar rechts, y is de hoogte boven het maaiveld (0 = grond, omhoog positief).
- breedte_m en hoogte_m zijn de afmetingen van het object in dat aanzicht (in het bovenaanzicht is hoogte_m de diepte).
- Gebruik de maten uit de offerte. Teken het nieuwe werk met het juiste materiaal (hout, beton, tegels, gras, grond, dak, glas, staal) en wat er al is (gevel, bestaande schutting) met materiaal "bestaand".
- Elementen: "vlak" (gesloten veelhoek, minstens 3 punten), "lijn" (2 of meer punten), "maatlijn" (precies 2 punten, label zoals "4,00 m", iets buiten het object) en "tekst" (1 punt met een kort label). Teken palen en staanders als kleine vlakken op hun echte plek, planken of gordingen als lijnen, een tegelvlak als één vlak. Zet maatlijnen voor de hoofdmaten. Maximaal ongeveer 40 elementen per aanzicht.

Schets op de foto
- ${aantalFotos ? `Er zijn ${aantalFotos} foto('s). Kies de foto waarop de plek van het nieuwe werk het best te zien is (foto = nummer, 1 = de eerste).` : 'Er zijn geen foto\'s: zet foto op null en laat de elementen leeg.'}
- Coördinaten van 0 tot 1000 over de breedte (x) en hoogte (y) van die foto, 0,0 is linksboven.
- Teken het nieuwe werk in perspectief op de plek waar het komt, passend bij de lijnen in de foto (gevel, grond, bestaande schutting). Gebruik vlakken met het juiste materiaal; markeer wat verdwijnt met materiaal "sloop". Zet er 2 tot 4 korte labels bij ("tekst"), bijvoorbeeld "Nieuwe overkapping 4 × 3 m".
- toelichting: één zin over wat de schets laat zien.

De offerte:
${JSON.stringify(kern)}`;
}

/** Laat de AI een werktekening en een schets op de foto maken. */
async function maakVisualisatie({ offerte, fotos }) {
  const content = [];
  fotos.forEach((foto, i) => {
    content.push({ type: 'text', text: `Foto ${i + 1}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: foto.mediaType, data: foto.data } });
  });
  content.push({ type: 'text', text: visualisatiePrompt(offerte, fotos.length) });

  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT, format: betaZodOutputFormat(VisualisatieSchema) },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') {
    throw new AgentFout('De AI weigerde deze visualisatie te maken. Probeer het opnieuw met andere foto\'s.');
  }
  if (!response.parsed_output) {
    throw new AgentFout('De AI gaf geen bruikbare tekening terug. Probeer het opnieuw.');
  }
  return response.parsed_output;
}

class AgentFout extends Error {}

module.exports = { stelOfferteOp, maakVisualisatie, zoekInPrijslijst, AgentFout, Anthropic };
