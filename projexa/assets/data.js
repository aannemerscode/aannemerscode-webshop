/* ==========================================================================
   Projexa — demodata
   De projecten, activiteiten, chatkoppen en het meerwerkvoorstel komen
   letterlijk uit het Projexa-ontwerp. De losse chatberichten van de drie
   overige gesprekken zijn aangevuld met plausibele voorbeeldtekst, omdat het
   ontwerp daarvan alleen de laatste regel toont.
   ========================================================================== */

window.PROJEXA = (function () {
  const projecten = [
    {
      naam: 'Verbouwing Jansen', plaats: 'Amsterdam', pct: 75, icon: 'i-building',
      status: 'In uitvoering', klant: 'Familie Jansen', urenTotaal: 186, meerwerk: '€685',
      taken: [
        { tekst: 'Voorzetwand slaapkamer plaatsen', wanneer: 'vandaag', staat: 'bezig' },
        { tekst: 'Leidingwerk verleggen (installateur)', wanneer: 'do 2 mei', staat: 'open' },
        { tekst: 'Balklaag laten keuren door constructeur', wanneer: 'vr 3 mei', staat: 'open' },
        { tekst: 'Stucwerk begane grond', wanneer: 'week 19', staat: 'open' }
      ]
    },
    {
      naam: 'Nieuwbouw De Vries', plaats: 'Utrecht', pct: 45, icon: 'i-home',
      status: 'In uitvoering', klant: 'Lisa de Vries', urenTotaal: 312, meerwerk: '€1.240',
      taken: [
        { tekst: 'Dakkapel plaatsen', wanneer: 'week 19', staat: 'bezig' },
        { tekst: 'Extra dakraam inmeten', wanneer: 'ma 6 mei', staat: 'open' },
        { tekst: 'Kozijnen leveren', wanneer: 'week 20', staat: 'open' }
      ]
    },
    {
      naam: 'Renovatie Bakker', plaats: 'Haarlem', pct: 20, icon: 'i-worker',
      status: 'Gestart', klant: 'Fam. Bakker', urenTotaal: 64, meerwerk: '€2.150',
      taken: [
        { tekst: 'Badkamer strippen', wanneer: 'deze week', staat: 'bezig' },
        { tekst: 'Vloerverwarming aanleggen', wanneer: 'week 20', staat: 'open' }
      ]
    },
    {
      naam: 'Uitbouw Peters', plaats: 'Almere', pct: 100, icon: 'i-building',
      status: 'Afgerond', klant: 'Mark Peters', urenTotaal: 244, meerwerk: '€0',
      taken: [
        { tekst: 'Opleverpunten afhandelen', wanneer: 'afgerond', staat: 'klaar' },
        { tekst: 'Eindfactuur versturen', wanneer: 'afgerond', staat: 'klaar' }
      ]
    }
  ];

  const activiteit = [
    { tekst: 'Jan heeft een foto toegevoegd', tijd: '2 min geleden',  icon: 'i-worker',    stijl: '' },
    { tekst: 'Meerwerk goedgekeurd',          tijd: '15 min geleden', icon: 'i-chat',      stijl: 'green' },
    { tekst: 'Nieuw bericht van klant',       tijd: '1 uur geleden',  icon: 'i-clipboard', stijl: 'gold' },
    { tekst: 'Uren geregistreerd',            tijd: '2 uur geleden',  icon: 'i-clock',     stijl: 'gold' }
  ];

  const gesprekken = [
    {
      id: 'jansen',
      naam: 'Verbouwing Jansen',
      preview: 'Jan: Foto toegevoegd',
      tijd: '14:32',
      icon: 'i-worker',
      berichten: [
        { van: 'ik', tekst: 'Goedemiddag, we hebben tijdens het slopen gezien dat de balken vervangen moeten worden.', tijd: '14:28', gelezen: true },
        { van: 'ik', foto: 'ph-beams', tijd: '14:29', gelezen: true },
        { van: 'klant', tekst: 'Dank voor de update en foto. Kunnen jullie een meerwerk voorstel sturen?', tijd: '14:31' },
        { van: 'ik', tekst: 'Zeker, komt eraan!', tijd: '14:32', gelezen: true }
      ]
    },
    {
      id: 'devries',
      naam: 'Nieuwbouw De Vries',
      preview: 'Lisa: Meerwerk akkoord?',
      tijd: '13:15',
      icon: 'i-doc',
      berichten: [
        { van: 'ik', tekst: 'Hoi Lisa, het extra dakraam kost €1.240,00 excl. btw. Voorstel staat klaar in het portaal.', tijd: '13:08', gelezen: true },
        { van: 'klant', tekst: 'Duidelijk, ik kijk er vanavond met Mark naar.', tijd: '13:12' },
        { van: 'klant', tekst: 'Meerwerk akkoord?', tijd: '13:15' }
      ]
    },
    {
      id: 'bakker',
      naam: 'Renovatie Bakker',
      preview: 'Piet: Uren ingevoerd',
      tijd: '11:45',
      icon: 'i-building',
      berichten: [
        { van: 'klant', tekst: 'Zijn de uren van vorige week al verwerkt?', tijd: '11:30' },
        { van: 'ik', tekst: 'Piet is er vanochtend mee bezig geweest.', tijd: '11:42', gelezen: true },
        { van: 'klant', tekst: 'Piet: Uren ingevoerd', tijd: '11:45' }
      ]
    },
    {
      id: 'peters',
      naam: 'Uitbouw Peters',
      preview: 'Mark: Planning update',
      tijd: '09:30',
      icon: 'i-calendar',
      berichten: [
        { van: 'ik', tekst: 'De oplevering staat gepland op vrijdag 17 mei.', tijd: '09:12', gelezen: true },
        { van: 'klant', tekst: 'Mark: Planning update', tijd: '09:30' }
      ]
    }
  ];

  const meerwerk = {
    nummer: 'MW-2024-001',
    titel: 'Wand verplaatsen slaapkamer',
    bedrag: '€685,00',
    status: 'In afwachting',
    omschrijving: 'Verplaatsen van de tussenwand met 20cm i.v.m. leidingwerk.',
    gemaaktOp: '1 mei 2024'
  };

  const updates = [
    { tekst: 'Jan heeft een foto toegevoegd', tijd: '2 min geleden',  icon: 'i-worker',   stijl: '' },
    { tekst: 'Meerwerk goedgekeurd',          tijd: '15 min geleden', icon: 'i-chat',     stijl: 'green' },
    { tekst: 'Nieuwe planning beschikbaar',   tijd: '1 uur geleden',  icon: 'i-calendar', stijl: 'gold' }
  ];

  return { projecten, activiteit, gesprekken, meerwerk, updates };
})();
