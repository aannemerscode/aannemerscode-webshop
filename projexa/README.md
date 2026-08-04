# Projexa — werkend format

Dit is het Projexa-ontwerp (de foto met "Prompt voor Claude") uitgewerkt tot een
werkende, responsive website. Alle informatie van het ontwerp is overgenomen, en
er is een aparte smartphone-versie bijgemaakt.

## De pagina's

Begin bij **`start.html`** — daar kies je een rol en loop je de demo door.

| Bestand | Wat het is |
|---|---|
| `start.html` | Inlogscherm: kies of je als aannemer, medewerker of klant kijkt. |
| `app.html` | De aannemer op laptop: dashboard, projecten, projectdetail, chat, uren, meerwerk, planning, documenten, notificaties, AI assistent, klanten, gebruikers, facturatie en abonnement. |
| `medewerker.html` | De medewerker op de telefoon: uren registreren, werkzaamheden invullen, foto's uploaden en chatten binnen projecten. |
| `mobiel.html` | De klant op de telefoon ("Mijn verbouwing"): voortgang, berichten, meerwerk goedkeuren, planning, foto's en documenten. |
| `index.html` | Het ontwerp uit de foto als webpagina: alle tekst plus de schermen in laptop-, telefoon- en vensterframes. |
| `demo.html` | Alles hierboven in één zelfstandig bestand, met een wisselbalk bovenin. Gebouwd door `build-demo.js`. |

## Openen

Geen build, geen server, geen internet nodig — dubbelklik `demo.html` (of
`start.html`), of serveer de map:

```bash
cd projexa
python3 -m http.server 8080
# open http://localhost:8080
```

## Alle tien de kernfuncties uit het ontwerp

| Functie | Waar je het ziet |
|---|---|
| Projecten dashboard | Aannemer → Dashboard en Projectdetail |
| Klantportaal | Klant (hele app) en Aannemer → Klanten & portaal |
| Chat | Alle drie de rollen, elk vanuit hun eigen kant van het gesprek |
| Urenregistratie | Aannemer → Uren, Medewerker → Vandaag |
| Werkzaamheden & foto's | Medewerker → Werk en Foto's |
| Meerwerk | Aannemer → Meerwerk (versturen), Klant → Meerwerk (goedkeuren) |
| Planning | Aannemer → Planning, Klant → Meer |
| Documenten | Aannemer → Documenten, Klant → Meer |
| Notificaties | Aannemer → Notificaties, met instellingen per soort melding |
| AI assistent | Aannemer → AI assistent (samenvatting + automatisch meerwerk) |

Daarnaast: gebruikersbeheer met de rechten per rol, facturatie & rapportages,
en het abonnement van €69,99 per maand met proefperiode en Stripe.

## Wat er werkt

- **Navigatie** — zijbalk (web) en tabbalk (mobiel), inclusief `#hash`-links
  zoals `app.html#chat`.
- **Projectdetail** — klik een project aan voor voortgang, open taken, uren,
  meerwerk, projectgegevens en foto's.
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
├── start.html          kies je rol
├── app.html            aannemer (web)
├── medewerker.html     medewerker (telefoon)
├── mobiel.html         klant (telefoon)
├── index.html          het ontwerp als webpagina
├── demo.html           alles in één bestand (gegenereerd)
├── build-demo.js       bouwt demo.html
└── assets/
    ├── base.css        kleuren, typografie, logo, knoppen
    ├── start.css       opmaak van het startscherm
    ├── brief.css       opmaak van het ontwerp
    ├── app.css         UI-componenten van de app
    ├── mobiel.css      opmaak voor de telefoon
    ├── data.js         demodata (projecten, chats, meerwerk)
    ├── app.js          logica aannemer
    ├── medewerker.js   logica medewerker
    ├── mobiel.js       logica klantportaal
    └── favicon.svg
```

Pas je iets aan in een van de losse pagina's? Draai dan `node build-demo.js`
om `demo.html` opnieuw te bouwen.

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
