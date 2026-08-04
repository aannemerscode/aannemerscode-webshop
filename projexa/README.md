# Projexa — werkend format

Dit is het Projexa-ontwerp (de foto met "Prompt voor Claude") uitgewerkt tot een
werkende, responsive website. Alle informatie van het ontwerp is overgenomen, en
er is een aparte smartphone-versie bijgemaakt.

## De drie pagina's

| Bestand | Wat het is |
|---|---|
| `index.html` | Het complete format: alle tekst uit het ontwerp (prompt, design­richtlijnen, de 10 kernfuncties, technische eisen, abonnement, prijskaart, gebruikers & rechten) plus de schermen als échte HTML in laptop-, telefoon- en vensterframes. Volledig responsive. |
| `app.html` | De werkende webversie voor de aannemer: dashboard, projecten, chat, urenregistratie, meerwerk, planning, documenten en klantportaal. |
| `mobiel.html` | De smartphone-versie (klantportaal "Mijn verbouwing") met tabbalk onderin. Op een telefoon schermvullend, op een groot scherm in een telefoonframe. |

## Openen

Geen build, geen server, geen internet nodig — dubbelklik `index.html`, of
serveer de map:

```bash
cd projexa
python3 -m http.server 8080
# open http://localhost:8080
```

## Wat er werkt

- **Navigatie** — zijbalk (web) en tabbalk (mobiel), inclusief `#hash`-links
  zoals `app.html#chat`.
- **Chat** — bericht typen en versturen, foto meesturen, van gesprek wisselen,
  zoeken in de gesprekken, leesbevestiging (dubbel vinkje) die na het versturen
  aanspringt.
- **Urenregistratie** — de timer loopt echt vanaf 07:30:45, met werkende
  Stop/Start en Pauze/Hervat, dagnavigatie, keuze van werkzaamheden en foto's
  toevoegen.
- **Meerwerk** — details uitklappen, "Stuur naar klant" (web) zet de status op
  *Verstuurd*, "Goedkeuren" (mobiel klantportaal) zet hem op *Goedgekeurd*.
- **Dashboard** — project toevoegen, en acties elders in de app verschijnen in
  "Laatste activiteit".
- **Documenten** — document toevoegen aan de lijst.

Alles draait in de browser; er is nog geen backend. Voor een echte SaaS komen
daar Supabase (auth, database, storage, realtime) en Stripe bij, zoals in de
technische eisen staat.

## Bestanden

```
projexa/
├── index.html          het format
├── app.html            werkende webversie
├── mobiel.html         smartphone-versie
└── assets/
    ├── base.css        kleuren, typografie, logo, knoppen
    ├── brief.css       opmaak van het format
    ├── app.css         UI-componenten van de app
    ├── mobiel.css      smartphone-opmaak
    ├── data.js         demodata (projecten, chats, meerwerk)
    ├── app.js          logica webversie
    ├── mobiel.js       logica smartphone-versie
    └── favicon.svg
```

Het logo, de iconen en de "foto's" zijn getekende SVG's in het bestand zelf —
er worden geen externe bestanden of lettertypen geladen, dus alles werkt ook
offline.

## Afwijkingen van het ontwerp

Bewust en klein gehouden, zodat het als werkende app klopt:

1. **Twee typefouten hersteld:** "communicener" → "communiceren" en
   "slapakmer" → "slaapkamer". De rest van de tekst is letterlijk overgenomen,
   inclusief "Een overzichtelijke platform" en "Intuitieve navigatie".
2. **"Zeker, komt eraan!"** staat in het ontwerp links (bij de klant), maar is
   een antwoord van de aannemer. In `index.html` staat de chat precies zoals in
   het ontwerp; in de werkende app staat dit bericht rechts, bij de aannemer.
3. **Onleesbare menu-items** in het ontwerp (de zijbalk op de laptop) zijn
   ingevuld met de functienamen uit de lijst: Dashboard, Projecten, Chat, Uren,
   Meerwerk, Planning, Documenten, Klantportaal.
4. **Aangevulde demodata** waar het ontwerp alleen een titel toont: de
   chatberichten van De Vries/Bakker/Peters, de planning, de documentenlijst en
   de meerwerkspecificatie. Alles wat het ontwerp wél toont (aantallen,
   projecten, percentages, tijden, bedragen, teksten) is exact overgenomen.
