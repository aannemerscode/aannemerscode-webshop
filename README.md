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

## Facturen

Sinds deze versie genereert de server automatisch een **PDF-factuur** per betaalde
bestelling (met een doorlopend factuurnummer, jouw bedrijfsgegevens en de btw
gesplitst) en stuurt die als bijlage mee met de bevestigingsmail — ook naar jezelf,
via `OWNER_EMAIL`, zodat je een eigen administratiekopie hebt.

Vul hiervoor in `.env` (en in Render → Environment) in elk geval in:
- `SELLER_NAME`, `SELLER_ADDRESS_LINE1`, `SELLER_ADDRESS_LINE2`
- `SELLER_KVK`, `SELLER_BTW` — wettelijk verplicht op een factuur
- `SELLER_IBAN` — optioneel, staat onderaan de factuur

Het factuurnummer loopt automatisch op per kalenderjaar (`2026-0001`, `2026-0002`, ...)
en wordt bijgehouden in `data/invoice-counter.json`. Bij een klein aantal bestellingen
per dag is dat prima; bij hoog volume kun je dit later vervangen door een factuurnummer
uit een echte database of boekhoudpakket (bijvoorbeeld Moneybird), zoals ook al
genoemd staat bij "Nog te doen voor een echte webshop" hieronder.

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

## In productie zetten: Render (aanbevolen)

Ik heb de map al klaargezet als git-repository (`git init` is al gedaan) en er staat een
`render.yaml` in, zodat Render de instellingen automatisch herkent. Jij hoeft alleen deze
stappen te doorlopen — dit vereist je eigen GitHub- en Render-account, dus dat kan ik niet
voor je invullen:

**1. Zet de code op GitHub**
- Maak (als je die nog niet hebt) een gratis account op github.com
- Maak daar een nieuw, leeg repository, bijvoorbeeld `aannemerscode-webshop` (zonder
  README/gitignore aan te vinken — dat heb je al)
- Voer lokaal in deze map uit (vervang de URL door die van jouw nieuwe repo):
  ```bash
  git remote add origin https://github.com/JOUW-GEBRUIKERSNAAM/aannemerscode-webshop.git
  git branch -M main
  git push -u origin main
  ```

**2. Koppel Render aan die repo**
- Ga naar render.com → maak een gratis account (kan direct met je GitHub-account inloggen)
- Klik "New" → "Blueprint" → kies je zojuist gepushte repository
- Render leest `render.yaml` en zet de service meteen goed neer (Node, `npm install`,
  `npm start`) — je hoeft alleen op "Apply" te klikken

**3. Vul de omgevingsvariabelen in**
- Render vraagt bij het aanmaken om de variabelen met `sync: false` (dat zijn precies je
  geheime/persoonlijke waarden): `MOLLIE_API_KEY`, `BASE_URL`, de `DOWNLOAD_URL_*`'s en je
  SMTP-gegevens — zelfde inhoud als je lokale `.env`
- Voor `BASE_URL`: vul die pas in ná de eerste deploy, zodra je de door Render toegewezen
  URL kent (zie stap 4) — je kunt hem later altijd aanpassen in Render → Environment

**4. Eerste deploy en BASE_URL corrigeren**
- Render deployt automatisch en geeft je een URL zoals
  `https://aannemerscode-webshop.onrender.com`
- Zet die exacte URL als waarde van `BASE_URL` in Render → Environment, en klik "Save,
  rebuild, and deploy" — dit is nodig omdat Mollie de webhook- en bedankt-pagina-links
  op basis van `BASE_URL` opbouwt

**5. Testen, dan pas live**
- Test eerst volledig met je Mollie **test**-API-key (gratis, geen echt geld)
- Werkt alles? Vervang `MOLLIE_API_KEY` in Render door je **live**-sleutel

**6. (Optioneel) eigen domein**
- Render → Settings → Custom Domain → volg de instructies om bijvoorbeeld
  `aannemerscode.nl` te koppelen via de DNS-instellingen bij je domeinprovider
- Vergeet niet `BASE_URL` daarna nogmaals bij te werken naar het eigen domein

Render's gratis laag "slaapt" na een periode zonder bezoekers en heeft dan een paar
seconden opstarttijd bij de eerstvolgende bezoeker — voor een klein product prima, maar
iets om te weten. Wil je dat niet, dan is de goedkoopste betaalde Render-laag (~$7/maand)
altijd actief.

## Alternatief: Railway

Werkt vrijwel hetzelfde (GitHub-repo koppelen, omgevingsvariabelen invullen, geen
`render.yaml` nodig — Railway herkent Node-projecten automatisch). Kies dit als je Render
om wat voor reden dan ook niet bevalt; functioneel maakt het voor deze app niet uit.


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
