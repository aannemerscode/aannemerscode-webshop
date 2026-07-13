# AannemersCode — webshop met iDEAL/Wero

Dit is een werkende webshop-backend voor de drie AannemersCode-producten (cursus,
rekentool, bundel), met echte betalingen via **Mollie**. Mollie is in Nederland de
standaardpartij voor iDEAL, en handelt de overgang naar **Wero** (het nieuwe Europese
betaalsysteem dat iDEAL vanaf 2026 geleidelijk vervangt) automatisch voor je af: zodra
Wero in Nederland live gaat, verschijnt het vanzelf als "iDEAL | Wero" in dezelfde
betaalpagina. Je hoeft daar zelf niets voor te bouwen.

## Wat dit wel en niet is

Dit is een compleet, werkend startpunt — geen kant-en-klare, live webshop. Er zijn een
paar dingen die alleen jij kan doen, omdat ze aan jouw bedrijf en bankrekening hangen:

1. **Een Mollie-account aanmaken** (gratis, 10 minuten): op mollie.com meld je je aan met
   je KvK-nummer en IBAN. Mollie verifieert je bedrijf — dat kan een dag of wat duren.
2. **Je eigen API-key ophalen** uit je Mollie-dashboard en in `.env` zetten.
3. **Dit ergens hosten** waar het 24/7 online staat (zie hieronder).
4. **De echte cursus/rekentool-bestanden** ergens neerzetten (bv. een Google Drive-link)
   zodat er na betaling ook echt iets te downloaden valt.

Zonder die vier stappen kan niemand écht afrekenen — dat kan ik niet voor je doen, omdat
het jouw bedrijfsgegevens en bankrekening zijn.

## Hoe het werkt

- De bezoeker klikt op "Bestel" → de server maakt een betaling aan bij Mollie → de
  bezoeker wordt doorgestuurd naar Mollies eigen (beveiligde) betaalpagina, waar iDEAL
  (straks iDEAL | Wero) gewoon als keuze verschijnt.
- Zodra er betaald is, stuurt Mollie een seintje naar `/api/webhook`. De server checkt de
  status en mailt daarna automatisch de downloadlink naar de klant.
- De klant komt terug op `bedankt.html`, die live de betaalstatus toont.

## Lokaal testen

```bash
npm install
cp .env.example .env
# vul MOLLIE_API_KEY in met je test-sleutel (begint met "test_")
npm start
```

Ga naar `http://localhost:3000`. Met een test-API-key kun je gratis een volledige
betaling doorlopen (Mollie's testomgeving simuleert iDEAL zonder dat er geld beweegt).

Let op: Mollie moet jouw `/api/webhook` kunnen bereiken. Op `localhost` lukt dat niet
zonder een tunnel — gebruik bijvoorbeeld [ngrok](https://ngrok.com) tijdens het testen:
```bash
ngrok http 3000
# zet de ngrok-URL als BASE_URL in .env
```

## In productie zetten

De eenvoudigste route:

1. Zet deze map in een git-repository (GitHub).
2. Maak een gratis/goedkoop account op **Render** of **Railway** (beide draaien een
   Node-server zoals deze zonder gedoe) — Vercel kan ook, maar is bedoeld voor
   "serverless" functies, waardoor `orders.json` niet betrouwbaar blijft bestaan tussen
   requests. Render/Railway houden een normale, altijd-actieve server draaiend.
3. Koppel je GitHub-repo, zet de `.env`-variabelen in het hosting-dashboard (nooit het
   `.env`-bestand zelf uploaden), en deploy.
4. Zet je eigen domein erop (bv. via de DNS-instellingen van je domeinprovider).
5. Vervang je `MOLLIE_API_KEY` door de **live**-sleutel zodra je live wilt gaan.

## Bestandsoverzicht

```
server.js          — de hele backend: checkout, webhook, orderstatus
public/index.html   — de landingspagina (nu gekoppeld aan de checkout-knoppen)
public/bedankt.html — bedankpagina die de betaalstatus toont
data/orders.json    — simpele bestelhistorie (vervang door een echte database
                       zodra je op een platform met tijdelijke opslag draait)
.env.example        — alle instelbare variabelen, met uitleg
```

## Nog te doen voor een "echte" webshop

- **Een database** in plaats van `orders.json` zodra je meer volume krijgt of op een
  serverless platform draait (Supabase heeft een genereuze gratis laag en is in een
  middag gekoppeld).
- **BTW-factuur per verkoop** — Mollie registreert de betaling, maar genereert geen
  factuur. Voor een paar producten kun je dit handmatig doen; bij meer volume is een
  koppeling met bijvoorbeeld Moneybird handig.
- **E-mail-deliverability**: een gewoon Gmail-account werkt voor de start, maar voor
  serieus volume is een dienst als Postmark of Resend betrouwbaarder (minder kans dat je
  downloadmail in de spam belandt).
