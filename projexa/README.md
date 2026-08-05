# Projexa — klantgerichte opzet

`opzet-klantgericht.html` is een uitgewerkte opzet van Projexa vanuit het perspectief van
de **huiseigenaar** in plaats van de aannemer.

De kern van de omslag:

| | Oud | Nieuw |
|---|---|---|
| Wie koopt | Aannemer (abonnement) | Huiseigenaar (per project) |
| Wie nodigt uit | Aannemer voegt klant toe | Klant nodigt aannemer + vakmensen uit |
| Wie kost het geld | Aannemer, elke maand | Klant, eenmalig per verbouwing |
| Van wie is het dossier | Van het bouwbedrijf | Van de woning / de eigenaar |

De pagina bevat de positionering, een klikbare voorbeeldomgeving ("Mijn verbouwing" met
overzicht, communicatie, bouwdagboek, documenten, meerwerk, akkoorden en dossier), de
uitnodigingsstroom, de prijzen per project en een sectie over de woordkeuze — bewust
"alles overzichtelijk vastgelegd" in plaats van "volledig gedekt".

Het ontwerp (zwart/goud, logo, iconen, componenten) is 1-op-1 overgenomen uit de
bestaande Projexa-omgeving, zodat deze opzet er direct naast past.

## Klikbare demo

`demo-klant.html` is de werkende demo van diezelfde opzet: **één project, twee kanten**.

- **Huiseigenaar** (telefoonweergave) — meerwerk goedkeuren of afwijzen, berichten sturen
  per partij, bouwdagboek en documenten doorbladeren, een vakman uitnodigen, het project
  bij oplevering afsluiten.
- **Aannemer** (desktop) — meerwerk voorstellen, dagrapport plaatsen, berichten sturen,
  zien wat de klant heeft vastgelegd.
Je begint op een inlogscherm: de huiseigenaar logt in het midden in met e-mailadres en
wachtwoord, de uitgenodigde partij onderaan met een projectcode. Die code en het bijbehorende
wachtwoord ontstaan op het moment dat de eigenaar iemand toevoegt — na het uitnodigen worden
ze getoond, en de eigenaar kan ze per bedrijf teruglezen. Log je in met de code van een
vakman, dan plaats je meerwerk, dagrapporten en berichten onder díe bedrijfsnaam.

Beide rollen delen dezelfde staat: wat je aan de ene kant doet, staat meteen aan de andere
kant. De staat leeft in het geheugen — bij verversen begint de demo opnieuw.

Demo-inlog: `thijs@voorbeeld.nl` / `demodemo` voor de eigenaar; de projectcode van de
hoofdaannemer staat vooringevuld.

## Bekijken

Open de bestanden in een browser, of publiceer ze als artifact. Alle stijlen, iconen en
scripts staan in de bestanden zelf — er zijn geen externe bronnen nodig.
