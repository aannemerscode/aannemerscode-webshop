const { z } = require('zod');

// ---------- Vorm van een offerte ----------
// Dit schema is tegelijk het "formulier" dat de AI-agent invult (via de tool
// dien_offerte_in) én de controle op aanpassingen die je zelf in de editor doet.
// Totalen rekent de server altijd zelf uit; die laten we nooit aan de AI over.

const RegelSchema = z.object({
  groep: z
    .string()
    .describe('Kopje waaronder de regel valt, bv. "Voorbereiding & sloop", "Fundering", "Schutting", "Dak", "Afvoer".'),
  soort: z.enum(['materiaal', 'arbeid', 'materieel', 'overig', 'stelpost']),
  omschrijving: z.string(),
  aantal: z.number(),
  eenheid: z.string().describe('bv. m1, m2, m3, stuk, uur, dag, post'),
  prijs_per_eenheid: z.number().describe('Verkoopprijs per eenheid in euro, excl. btw'),
  btw_percentage: z.union([z.literal(21), z.literal(9), z.literal(0)]),
  prijsbron: z
    .enum(['prijslijst', 'schatting'])
    .describe('"prijslijst" als de prijs uit zoek_prijslijst komt, anders "schatting"'),
  artikelcode: z.string().nullable().describe('Code uit de prijslijst, of null'),
  toelichting: z
    .string()
    .nullable()
    .describe('Korte onderbouwing van het aantal, bv. "12 m1 × 1,1 u/m1" of "2 lagen × 18 m2 / 25 m2 per blik"'),
});

const OfferteSchema = z.object({
  titel: z.string().describe('Korte projecttitel, bv. "Nieuwe hout-betonschutting achtertuin (14 m1)"'),
  type_klus: z.enum(['tuinklus', 'timmerwerk', 'tuinhuis', 'overkapping', 'combinatie']),
  fotoanalyse: z
    .string()
    .describe("Wat er op de foto's te zien is: huidige situatie, ondergrond, bereikbaarheid, en de geschatte maten met waarop die schatting is gebaseerd."),
  werkomschrijving: z
    .string()
    .describe('Werkomschrijving voor de klant in heldere stappen, in de u-vorm. Gebruik regeleinden tussen de stappen.'),
  regels: z.array(RegelSchema),
  aannames: z.array(z.string()).describe('Aannames waarop de prijs gebaseerd is (maten, ondergrond, bereikbaarheid, ...)'),
  uitsluitingen: z.array(z.string()).describe('Wat er níet in de prijs zit'),
  vragen_aan_klant: z.array(z.string()).describe('Wat je moet navragen of ter plekke moet inmeten voordat de prijs definitief is'),
  vergunning_advies: z.string().describe('Korte inschatting of een omgevingsvergunning nodig kan zijn, met verwijzing naar het Omgevingsloket'),
  uitvoering: z.object({
    werkdagen: z.number(),
    aantal_personen: z.number(),
  }),
  betrouwbaarheid: z.enum(['hoog', 'gemiddeld', 'laag']),
  betrouwbaarheid_toelichting: z.string(),
});

const KlantSchema = z.object({
  naam: z.string().default(''),
  adres: z.string().default(''),
  postcode_plaats: z.string().default(''),
  email: z.string().default(''),
  telefoon: z.string().default(''),
});

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function berekenTotalen(offerte) {
  const regels = offerte.regels.map((r) => ({ ...r, totaal: round2(r.aantal * r.prijs_per_eenheid) }));
  const subtotaal = round2(regels.reduce((s, r) => s + r.totaal, 0));

  const btwPerTarief = {};
  for (const r of regels) {
    btwPerTarief[r.btw_percentage] = (btwPerTarief[r.btw_percentage] || 0) + r.totaal;
  }
  const btw = Object.entries(btwPerTarief)
    .map(([pct, grondslag]) => ({
      percentage: Number(pct),
      grondslag: round2(grondslag),
      bedrag: round2((grondslag * Number(pct)) / 100),
    }))
    .sort((a, b) => b.percentage - a.percentage);
  const btwTotaal = round2(btw.reduce((s, b) => s + b.bedrag, 0));

  const perSoort = {};
  for (const r of regels) perSoort[r.soort] = round2((perSoort[r.soort] || 0) + r.totaal);

  return {
    regels,
    subtotaal,
    btw,
    totaal: round2(subtotaal + btwTotaal),
    perSoort,
    geschatAandeel: subtotaal ? round2(
      (regels.filter((r) => r.prijsbron === 'schatting').reduce((s, r) => s + r.totaal, 0) / subtotaal) * 100
    ) : 0,
  };
}

module.exports = { OfferteSchema, RegelSchema, KlantSchema, berekenTotalen, round2 };
