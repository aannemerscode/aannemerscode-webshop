const PDFDocument = require('pdfkit');

// ---------- Offerte (PDF) ----------
// Zelfde opzet als de factuur in server.js: A4, Helvetica, eigen gegevens linksboven.

const euro = (n) =>
  '€ ' + n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const getal = (n) => n.toLocaleString('nl-NL', { maximumFractionDigits: 2 });

const LINKS = 50;
const RECHTS = 545;
const KOLOM = { omschrijving: 50, aantal: 300, eenheid: 350, prijs: 395, totaal: 470 };

function genereerOffertePdf(record, seller) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const { offerte, totalen, klant, nummer, createdAt } = record;
    const datum = new Date(createdAt);
    const geldigTot = new Date(datum.getTime() + 30 * 24 * 3600 * 1000);
    const onderrand = () => doc.page.height - doc.page.margins.bottom;
    const ruimte = (h) => {
      if (doc.y + h > onderrand()) doc.addPage();
    };
    const kop = (tekst) => {
      ruimte(40);
      doc.moveDown(0.8);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#0F243B').text(tekst, LINKS);
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(9.5).fillColor('#000');
    };
    const lijst = (items) => {
      for (const item of items) {
        ruimte(20);
        doc.text(`•  ${item}`, LINKS + 6, doc.y, { width: RECHTS - LINKS - 6 });
      }
    };

    // Header
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#0F243B').text(seller.name, LINKS);
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(9).fillColor('#555');
    if (seller.addressLine1) doc.text(seller.addressLine1);
    if (seller.addressLine2) doc.text(seller.addressLine2);
    if (seller.kvk) doc.text(`KVK: ${seller.kvk}`);
    if (seller.btw) doc.text(`Btw-id: ${seller.btw}`);
    if (seller.email) doc.text(seller.email);

    const headerY = 50;
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#000').text('Offerte', 300, headerY, { width: 245, align: 'right' });
    doc.font('Helvetica').fontSize(9.5);
    doc.text(`Offertenummer: ${nummer}`, 300, doc.y + 2, { width: 245, align: 'right' });
    doc.text(`Datum: ${datum.toLocaleDateString('nl-NL')}`, { width: 245, align: 'right' });
    doc.text(`Geldig tot: ${geldigTot.toLocaleDateString('nl-NL')}`, { width: 245, align: 'right' });

    doc.y = Math.max(doc.y, 140);
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(10).text('Aan', LINKS);
    doc.font('Helvetica').fontSize(9.5);
    for (const r of [klant.naam, klant.adres, klant.postcode_plaats, klant.email, klant.telefoon]) {
      if (r) doc.text(r, LINKS);
    }

    doc.moveDown(1.2);
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#0F243B').text(offerte.titel, LINKS, doc.y, { width: RECHTS - LINKS });
    doc.fillColor('#000');

    kop('Werkomschrijving');
    doc.text(offerte.werkomschrijving, LINKS, doc.y, { width: RECHTS - LINKS });

    // Prijsspecificatie, gegroepeerd per kopje
    kop('Prijsspecificatie');
    const tabelKop = () => {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#555');
      doc.text('Omschrijving', KOLOM.omschrijving, y);
      doc.text('Aantal', KOLOM.aantal, y, { width: 45, align: 'right' });
      doc.text('Eenh.', KOLOM.eenheid, y, { width: 40 });
      doc.text('Prijs/eenh.', KOLOM.prijs, y, { width: 70, align: 'right' });
      doc.text('Totaal', KOLOM.totaal, y, { width: 75, align: 'right' });
      doc.moveTo(LINKS, y + 12).lineTo(RECHTS, y + 12).strokeColor('#ccc').stroke();
      doc.y = y + 17;
      doc.font('Helvetica').fontSize(9).fillColor('#000');
    };
    tabelKop();

    const groepen = [];
    for (const r of totalen.regels) {
      let g = groepen.find((x) => x.naam === r.groep);
      if (!g) groepen.push((g = { naam: r.groep, regels: [] }));
      g.regels.push(r);
    }

    for (const g of groepen) {
      ruimte(34);
      if (doc.y < 70) tabelKop();
      doc.font('Helvetica-Bold').fontSize(9).text(g.naam, LINKS, doc.y + 3);
      doc.font('Helvetica').fontSize(9);
      for (const r of g.regels) {
        const label = r.soort === 'stelpost' ? `${r.omschrijving} (stelpost)` : r.omschrijving;
        const hoogte = doc.heightOfString(label, { width: 240 });
        if (doc.y + hoogte + 4 > onderrand()) {
          doc.addPage();
          tabelKop();
        }
        const y = doc.y + 2;
        doc.text(label, KOLOM.omschrijving + 8, y, { width: 240 });
        const yNa = doc.y;
        doc.text(getal(r.aantal), KOLOM.aantal, y, { width: 45, align: 'right' });
        doc.text(r.eenheid, KOLOM.eenheid, y, { width: 40 });
        doc.text(euro(r.prijs_per_eenheid), KOLOM.prijs, y, { width: 70, align: 'right' });
        doc.text(euro(r.totaal), KOLOM.totaal, y, { width: 75, align: 'right' });
        doc.y = yNa;
      }
      const subtotaal = g.regels.reduce((s, r) => s + r.totaal, 0);
      doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#555');
      doc.text(`Subtotaal ${g.naam.toLowerCase()}: ${euro(subtotaal)}`, KOLOM.prijs - 100, doc.y + 2, { width: 245, align: 'right' });
      doc.font('Helvetica').fontSize(9).fillColor('#000');
      doc.moveDown(0.3);
    }

    // Totalen
    ruimte(30 + totalen.btw.length * 14);
    const totY = doc.y + 6;
    doc.moveTo(300, totY).lineTo(RECHTS, totY).strokeColor('#ccc').stroke();
    doc.y = totY + 6;
    const totaalRegel = (label, bedrag, vet) => {
      const y = doc.y;
      doc.font(vet ? 'Helvetica-Bold' : 'Helvetica').fontSize(vet ? 11 : 9.5);
      doc.text(label, 300, y, { width: 160, align: 'right' });
      doc.text(euro(bedrag), KOLOM.totaal, y, { width: 75, align: 'right' });
      doc.moveDown(0.3);
    };
    totaalRegel('Totaal excl. btw', totalen.subtotaal);
    for (const b of totalen.btw) totaalRegel(`Btw ${b.percentage}% over ${euro(b.grondslag)}`, b.bedrag);
    totaalRegel('Totaal incl. btw', totalen.totaal, true);

    if (offerte.uitvoering?.werkdagen) {
      kop('Planning');
      doc.text(
        `Geschatte uitvoeringsduur: ${getal(offerte.uitvoering.werkdagen)} werkdag(en) met ${getal(offerte.uitvoering.aantal_personen)} man, afhankelijk van het weer.`,
        LINKS
      );
    }
    if (offerte.aannames.length) {
      kop('Uitgangspunten');
      lijst(offerte.aannames);
    }
    if (offerte.uitsluitingen.length) {
      kop('Niet inbegrepen');
      lijst(offerte.uitsluitingen);
    }
    if (offerte.vergunning_advies) {
      kop('Vergunning');
      doc.text(offerte.vergunning_advies, LINKS, doc.y, { width: RECHTS - LINKS });
    }

    kop('Voorwaarden');
    lijst([
      `Deze offerte is geldig tot ${geldigTot.toLocaleDateString('nl-NL')}.`,
      'Stelposten worden verrekend op basis van werkelijk gemaakte kosten.',
      'Meer- en minderwerk wordt vooraf met u afgestemd en apart verrekend.',
    ]);

    ruimte(90);
    doc.moveDown(2);
    const tekenY = doc.y;
    doc.font('Helvetica').fontSize(9.5);
    doc.text('Voor akkoord opdrachtgever:', LINKS, tekenY);
    doc.text(`Namens ${seller.name}:`, 320, tekenY);
    doc.moveTo(LINKS, tekenY + 50).lineTo(250, tekenY + 50).strokeColor('#999').stroke();
    doc.moveTo(320, tekenY + 50).lineTo(RECHTS, tekenY + 50).strokeColor('#999').stroke();
    doc.fontSize(8).fillColor('#777').text('Naam, datum en handtekening', LINKS, tekenY + 55);

    // Paginanummers
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.page.margins.bottom = 0; // anders maakt pdfkit voor de voettekst een nieuwe pagina aan
      doc.font('Helvetica').fontSize(8).fillColor('#999');
      doc.text(`${nummer} — pagina ${i + 1} van ${range.count}`, LINKS, doc.page.height - 35, {
        width: RECHTS - LINKS,
        align: 'center',
        lineBreak: false,
      });
    }

    doc.end();
  });
}

module.exports = { genereerOffertePdf };
