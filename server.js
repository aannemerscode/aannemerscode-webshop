require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const { createMollieClient } = require('@mollie/api-client');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ---------- Jouw bedrijfsgegevens (voor op de factuur) ----------
// Vul deze in via Render -> Environment. Zonder KVK/btw-nummer mag je wettelijk
// geen facturen sturen, dus de server waarschuwt hieronder als ze ontbreken.
const SELLER = {
  name: process.env.SELLER_NAME || 'AannemersCode',
  addressLine1: process.env.SELLER_ADDRESS_LINE1 || '',
  addressLine2: process.env.SELLER_ADDRESS_LINE2 || '',
  kvk: process.env.SELLER_KVK || '',
  btw: process.env.SELLER_BTW || '',
  iban: process.env.SELLER_IBAN || '',
  email: process.env.MAIL_FROM_ADDRESS || process.env.SMTP_USER || '',
};

if (!SELLER_kvkCheck()) {
  console.warn(
    '[waarschuwing] SELLER_KVK en/of SELLER_BTW ontbreken in .env — facturen worden wel aangemaakt, maar zijn zo nog niet wettelijk compleet.'
  );
}
function SELLER_kvkCheck() {
  return Boolean(SELLER.kvk && SELLER.btw);
}

if (!process.env.MOLLIE_API_KEY) {
  console.warn(
    '[waarschuwing] MOLLIE_API_KEY ontbreekt in .env — checkouts zullen mislukken totdat je die instelt.'
  );
}

const mollieClient = createMollieClient({
  apiKey: process.env.MOLLIE_API_KEY || 'test_placeholder',
});

// ---------- Productcatalogus ----------
// Prijzen en downloadlinks staan in .env zodat je ze kunt aanpassen zonder de code te wijzigen.
const PRODUCTS = {
  cursus: {
    id: 'cursus',
    name: 'AannemersCode — Cursus',
    description: 'Cursusdocument · 11 modules · sjablonen · checklists',
    price: process.env.PRICE_CURSUS || '325.00',
    downloadUrl: process.env.DOWNLOAD_URL_CURSUS || null,
  },
  rekentool: {
    id: 'rekentool',
    name: 'AannemersCode — Rekentool',
    description: 'Uurtarief- & projectcalculatie · offertes',
    price: process.env.PRICE_REKENTOOL || '175.00',
    downloadUrl: process.env.DOWNLOAD_URL_REKENTOOL || null,
  },
  bundel: {
    id: 'bundel',
    name: 'AannemersCode — Bundel',
    description: 'Cursus + rekentool · alles in één',
    price: process.env.PRICE_BUNDEL || '450.00',
    downloadUrl: process.env.DOWNLOAD_URL_BUNDEL || null,
  },
};

// ---------- Simpele bestel-opslag (JSON-bestand) ----------
// Prima voor de start; vervang dit door een echte database (bv. Supabase/Postgres)
// zodra je op een platform met een ephemeral filesystem draait (zoals Vercel),
// want daar overleven bestandswijzigingen een herstart niet.
const ORDERS_FILE = path.join(__dirname, 'data', 'orders.json');
const INVOICE_COUNTER_FILE = path.join(__dirname, 'data', 'invoice-counter.json');

// Losse opslag voor de Projexa-landingspagina: hier komen de reacties in terecht
// waarmee je toetst of er vraag naar Projexa is.
const PROJEXA_FILE = path.join(__dirname, 'data', 'projexa-reacties.json');

function ensureDataDir() {
  const dir = path.dirname(ORDERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, '{}');
  if (!fs.existsSync(INVOICE_COUNTER_FILE)) {
    fs.writeFileSync(INVOICE_COUNTER_FILE, JSON.stringify({ year: new Date().getFullYear(), next: 1 }));
  }
  if (!fs.existsSync(PROJEXA_FILE)) {
    fs.writeFileSync(PROJEXA_FILE, JSON.stringify({ bezoeken: [], prijsklikken: [], aanmeldingen: [] }, null, 2));
  }
}
ensureDataDir();

function readProjexa() {
  try {
    const data = JSON.parse(fs.readFileSync(PROJEXA_FILE, 'utf8'));
    return {
      bezoeken: data.bezoeken || [],
      prijsklikken: data.prijsklikken || [],
      aanmeldingen: data.aanmeldingen || [],
    };
  } catch {
    return { bezoeken: [], prijsklikken: [], aanmeldingen: [] };
  }
}
function writeProjexa(data) {
  fs.writeFileSync(PROJEXA_FILE, JSON.stringify(data, null, 2));
}

// Simpel doorlopend factuurnummer per jaar: 2026-0001, 2026-0002, ...
// Let op: bij meerdere gelijktijdige bestellingen op een drukke dag kan dit in
// zeldzame gevallen een nummer overslaan of dubbel gebruiken (geen databaselock).
// Vervang dit door een echte database zodra je volume dat rechtvaardigt.
function nextInvoiceNumber() {
  let counter;
  try {
    counter = JSON.parse(fs.readFileSync(INVOICE_COUNTER_FILE, 'utf8'));
  } catch {
    counter = { year: new Date().getFullYear(), next: 1 };
  }
  const currentYear = new Date().getFullYear();
  if (counter.year !== currentYear) {
    counter = { year: currentYear, next: 1 };
  }
  const number = `${currentYear}-${String(counter.next).padStart(4, '0')}`;
  counter.next += 1;
  fs.writeFileSync(INVOICE_COUNTER_FILE, JSON.stringify(counter));
  return number;
}

function readOrders() {
  try {
    return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function writeOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

// ---------- Factuur (PDF) ----------
function generateInvoicePdf(order, product) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const priceExcl = Number(product.price);
    const btwPct = 21; // digitale producten: standaard btw-tarief
    const btwBedrag = priceExcl - priceExcl / (1 + btwPct / 100);
    const priceExclCalc = priceExcl - btwBedrag;

    // Header: eigen bedrijfsgegevens
    doc.font('Helvetica-Bold').fontSize(20).text(SELLER.name);
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(9).fillColor('#555');
    if (SELLER.addressLine1) doc.text(SELLER.addressLine1);
    if (SELLER.addressLine2) doc.text(SELLER.addressLine2);
    if (SELLER.kvk) doc.text(`KVK: ${SELLER.kvk}`);
    if (SELLER.btw) doc.text(`Btw-id: ${SELLER.btw}`);
    if (SELLER.email) doc.text(SELLER.email);
    doc.fillColor('#000');

    doc.moveDown(1.5);
    doc.font('Helvetica-Bold').fontSize(16).text('Factuur', { align: 'right' });
    doc.font('Helvetica').fontSize(10).text(`Factuurnummer: ${order.invoiceNumber}`, { align: 'right' });
    doc.text(`Factuurdatum: ${new Date(order.paidAt).toLocaleDateString('nl-NL')}`, { align: 'right' });
    doc.text(`Ordernummer: ${order.id}`, { align: 'right' });

    doc.moveDown(1.5);
    doc.font('Helvetica-Bold').fontSize(11).text('Factuuradres');
    doc.font('Helvetica').fontSize(10);
    if (order.customerName) doc.text(order.customerName);
    if (order.customerAddress) doc.text(order.customerAddress);
    doc.text(order.email);

    doc.moveDown(1.5);

    // Regel met het product
    const tableTop = doc.y;
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Omschrijving', 50, tableTop);
    doc.text('Bedrag excl. btw', 300, tableTop, { width: 90, align: 'right' });
    doc.text(`Btw (${btwPct}%)`, 390, tableTop, { width: 70, align: 'right' });
    doc.text('Totaal incl. btw', 460, tableTop, { width: 90, align: 'right' });
    doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).strokeColor('#ccc').stroke();

    const rowY = tableTop + 25;
    doc.font('Helvetica').fontSize(10);
    doc.text(product.name, 50, rowY, { width: 240 });
    doc.text(`€ ${priceExclCalc.toFixed(2)}`, 300, rowY, { width: 90, align: 'right' });
    doc.text(`€ ${btwBedrag.toFixed(2)}`, 390, rowY, { width: 70, align: 'right' });
    doc.text(`€ ${priceExcl.toFixed(2)}`, 460, rowY, { width: 90, align: 'right' });

    doc.moveTo(50, rowY + 25).lineTo(550, rowY + 25).strokeColor('#ccc').stroke();

    doc.font('Helvetica-Bold').fontSize(11);
    doc.text('Totaal', 300, rowY + 35, { width: 160, align: 'right' });
    doc.text(`€ ${priceExcl.toFixed(2)}`, 460, rowY + 35, { width: 90, align: 'right' });

    doc.moveDown(4);
    doc.font('Helvetica').fontSize(9).fillColor('#555');
    doc.text('Deze factuur betreft een direct downloadbaar digitaal product, betaald via iDEAL/Mollie.');
    if (SELLER.iban) doc.text(`IBAN: ${SELLER.iban}`);

    doc.end();
  });
}

// ---------- E-mailopmaak (HTML, in de AannemersCode-huisstijl) ----------
function buildEmailHtml({ product, order, downloadUrl }) {
  const navy = '#0F243B';
  const cream = '#E5E0CE';
  const accent = '#DA4C1A';
  const muted = '#8FA0AE';

  const downloadBlock = downloadUrl
    ? `<tr><td style="padding:28px 40px 8px;">
         <a href="${downloadUrl}" style="display:inline-block; background:${accent}; color:#ffffff; font-family:Arial,sans-serif; font-weight:bold; font-size:14px; text-decoration:none; padding:14px 28px; border-radius:2px;">Download je ${product.name.split('—')[1] ? product.name.split('—')[1].trim() : 'bestand'} →</a>
       </td></tr>`
    : `<tr><td style="padding:28px 40px 8px; font-family:Arial,sans-serif; font-size:14px; color:${navy};">Je downloadlink volgt zo apart.</td></tr>`;

  return `
  <div style="background:#f2f0ea; padding:32px 16px; font-family:Arial,sans-serif;">
    <table role="presentation" width="100%" style="max-width:520px; margin:0 auto; background:#ffffff; border-radius:6px; overflow:hidden; border-collapse:collapse;">
      <tr>
        <td style="background:${navy}; padding:24px 40px;">
          <span style="font-family:Arial,sans-serif; font-weight:bold; font-size:19px; letter-spacing:0.02em; color:${cream};">AANNEMERS<span style="color:${accent === '#DA4C1A' ? '#E8825A' : accent};">CODE</span></span>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 40px 8px; font-family:Arial,sans-serif; font-size:20px; color:${navy}; font-weight:bold;">
          Bedankt voor je bestelling
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px; font-family:Arial,sans-serif; font-size:14px; line-height:1.6; color:#3a4450;">
          Je hebt <strong>${product.name}</strong> besteld. Hieronder vind je je download; de factuur zit als PDF-bijlage bij deze e-mail.
        </td>
      </tr>
      ${downloadBlock}
      <tr>
        <td style="padding:28px 40px 0;">
          <table role="presentation" width="100%" style="border-collapse:collapse; border-top:1px solid #e2e2e2; padding-top:16px; font-family:Arial,sans-serif; font-size:13px; color:${muted};">
            <tr><td style="padding:16px 0 4px;">Ordernummer</td><td style="padding:16px 0 4px; text-align:right; color:${navy};">${order.id}</td></tr>
            <tr><td style="padding:4px 0;">Factuurnummer</td><td style="padding:4px 0; text-align:right; color:${navy};">${order.invoiceNumber}</td></tr>
            <tr><td style="padding:4px 0;">Bedrag</td><td style="padding:4px 0; text-align:right; color:${navy};">€ ${Number(product.price).toFixed(2)}</td></tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 40px 32px; font-family:Arial,sans-serif; font-size:12px; color:${muted};">
          Vragen over je bestelling? Antwoord gewoon op deze e-mail.
        </td>
      </tr>
      <tr>
        <td style="background:${navy}; padding:16px 40px; font-family:Arial,sans-serif; font-size:11px; color:${muted};">
          © ${new Date().getFullYear()} AannemersCode
        </td>
      </tr>
    </table>
  </div>`;
}

// ---------- Mail (fulfillment) ----------
function buildTransporter() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendDownloadEmail(order) {
  const transporter = buildTransporter();
  const product = PRODUCTS[order.productId];

  let invoiceBuffer = null;
  try {
    invoiceBuffer = await generateInvoicePdf(order, product);
  } catch (err) {
    console.error('Factuur-fout:', err);
  }

  if (!transporter) {
    console.log(
      `[mail overgeslagen] Geen SMTP ingesteld. Zou nu de download + factuur ${order.invoiceNumber} voor "${product.name}" hebben gestuurd naar ${order.email}.`
    );
    return;
  }
  const downloadLine = product.downloadUrl
    ? `Download hier: ${product.downloadUrl}`
    : 'Je downloadlink volgt zo — er is nog geen DOWNLOAD_URL ingesteld voor dit product.';

  const attachments = invoiceBuffer
    ? [{ filename: `Factuur-${order.invoiceNumber}.pdf`, content: invoiceBuffer }]
    : [];

  const html = buildEmailHtml({ product, order, downloadUrl: product.downloadUrl });

  await transporter.sendMail({
    from: process.env.MAIL_FROM || 'AannemersCode <no-reply@aannemerscode.nl>',
    to: order.email,
    subject: `Je bestelling: ${product.name} (factuur ${order.invoiceNumber})`,
    text: `Bedankt voor je bestelling van ${product.name}.\n\n${downloadLine}\n\nOrdernummer: ${order.id}\nFactuurnummer: ${order.invoiceNumber}\n\nDe factuur vind je als PDF-bijlage bij deze e-mail.`,
    html,
    attachments,
  });

  if (process.env.OWNER_EMAIL) {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || 'AannemersCode <no-reply@aannemerscode.nl>',
      to: process.env.OWNER_EMAIL,
      subject: `Nieuwe verkoop: ${product.name}`,
      text: `${order.email} heeft ${product.name} gekocht voor €${product.price}. Order: ${order.id}. Factuur: ${order.invoiceNumber}.`,
      attachments,
    });
  }
}

// ---------- Routes ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Mollie webhook stuurt form-encoded data
app.use(express.static(path.join(__dirname, 'public')));

// Checkout starten
app.post('/api/checkout', async (req, res) => {
  try {
    const { productId, email, customerName, customerAddress } = req.body;
    const product = PRODUCTS[productId];
    if (!product) {
      return res.status(400).json({ error: 'Onbekend product.' });
    }
    if (!email) {
      return res.status(400).json({ error: 'E-mailadres is verplicht voor de bezorging van je download.' });
    }

    const payment = await mollieClient.payments.create({
      amount: { currency: 'EUR', value: product.price },
      description: product.name,
      redirectUrl: `${BASE_URL}/bedankt.html?orderId={id}`.replace('{id}', ''), // wordt hieronder overschreven met echt orderId
      webhookUrl: `${BASE_URL}/api/webhook`,
      metadata: { productId },
      // Mollie toont hier automatisch iDEAL, en zodra Wero in NL live is,
      // verschijnt dat als "iDEAL | Wero" in dezelfde hosted checkout — geen aparte
      // integratie nodig. Je kunt hieronder desgewenst methods: ['ideal'] forceren.
    });

    const orders = readOrders();
    orders[payment.id] = {
      id: payment.id,
      productId,
      email,
      customerName: customerName || '',
      customerAddress: customerAddress || '',
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    writeOrders(orders);

    // redirectUrl nu met het echte orderId
    await mollieClient.payments.update(payment.id, {
      redirectUrl: `${BASE_URL}/bedankt.html?orderId=${payment.id}`,
    }).catch(() => {
      // Niet elke Mollie-account/plan staat updates toe na aanmaak; dat is geen blokkerende fout.
    });

    return res.json({ checkoutUrl: payment.getCheckoutUrl() });
  } catch (err) {
    console.error('Checkout-fout:', err);
    return res.status(500).json({ error: 'Kon de betaling niet starten. Check je MOLLIE_API_KEY.' });
  }
});

// Mollie webhook: hier komt de echte betaalbevestiging binnen
app.post('/api/webhook', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).end();

    const payment = await mollieClient.payments.get(id);
    const orders = readOrders();
    const order = orders[id];
    if (!order) return res.status(200).end(); // onbekende/oude order, negeren

    if (payment.status === 'paid' && order.status !== 'fulfilled') {
      order.status = 'fulfilled';
      order.paidAt = new Date().toISOString();
      order.invoiceNumber = order.invoiceNumber || nextInvoiceNumber();
      writeOrders(orders);
      await sendDownloadEmail(order);
    } else if (payment.status !== order.status) {
      order.status = payment.status; // bv. 'open', 'canceled', 'expired', 'failed'
      writeOrders(orders);
    }

    return res.status(200).end();
  } catch (err) {
    console.error('Webhook-fout:', err);
    return res.status(500).end();
  }
});

// Simpel orderstatus-endpoint voor de bedankt-pagina
app.get('/api/order/:id', (req, res) => {
  const orders = readOrders();
  const order = orders[req.params.id];
  if (!order) return res.status(404).json({ error: 'Niet gevonden' });
  res.json({ status: order.status, productId: order.productId });
});


// ---------- Projexa: vraag toetsen via de landingspagina ----------
// De landingspagina staat op /projexa/. Hier komen drie dingen binnen:
// een bezoek, een klik op een prijskaart en een ingevuld formulier. Samen
// vertellen ze hoeveel mensen kijken, welk bedrag ze aanklikken en wat ze
// zeggen te willen betalen.

const PROJEXA_PAKKETTEN = {
  basis: { naam: 'Basis', prijs: '149,95' },
  compleet: { naam: 'Compleet', prijs: '249,95' },
  nieuwbouw: { naam: 'Nieuwbouw', prijs: '399,95' },
};

function kort(waarde, max) {
  return String(waarde == null ? '' : waarde).slice(0, max);
}

app.post('/api/projexa/gebeurtenis', (req, res) => {
  try {
    const { soort, bezoeker, pakket, verwijzer, zoekcode } = req.body || {};
    const data = readProjexa();
    const nu = new Date().toISOString();

    if (soort === 'bezoek') {
      // Eén bezoek per browser per dag telt; herladen blaast de cijfers anders op.
      const vandaag = nu.slice(0, 10);
      const alGeteld = data.bezoeken.some(
        (b) => b.bezoeker === bezoeker && String(b.op).slice(0, 10) === vandaag
      );
      if (!alGeteld) {
        data.bezoeken.push({
          bezoeker: kort(bezoeker, 40),
          op: nu,
          verwijzer: kort(verwijzer, 200),
          zoekcode: kort(zoekcode, 200),
        });
        writeProjexa(data);
      }
      return res.json({ ok: true });
    }

    if (soort === 'prijsklik') {
      if (!PROJEXA_PAKKETTEN[pakket]) return res.status(400).json({ error: 'Onbekend pakket.' });
      data.prijsklikken.push({ bezoeker: kort(bezoeker, 40), pakket, op: nu });
      writeProjexa(data);
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Onbekende gebeurtenis.' });
  } catch (err) {
    console.error('Projexa-gebeurtenis mislukt:', err);
    return res.status(500).json({ error: 'Kon dit niet opslaan.' });
  }
});

app.post('/api/projexa/aanmelding', async (req, res) => {
  try {
    const { bezoeker, pakket, gebruik, bedrag, wanneer, opmerking, email } = req.body || {};

    if (!gebruik || !bedrag) {
      return res.status(400).json({ error: 'Vul in of je Projexa zou gebruiken en wat je ervoor zou betalen.' });
    }

    const data = readProjexa();
    const reactie = {
      id: 'r' + Date.now().toString(36),
      op: new Date().toISOString(),
      bezoeker: kort(bezoeker, 40),
      pakket: PROJEXA_PAKKETTEN[pakket] ? pakket : '',
      gebruik: kort(gebruik, 20),
      bedrag: kort(bedrag, 20),
      wanneer: kort(wanneer, 20),
      opmerking: kort(opmerking, 2000),
      email: kort(email, 200),
    };

    data.aanmeldingen.push(reactie);
    writeProjexa(data);

    // Zelf even een seintje krijgen, zodat je niet elke dag het dashboard hoeft te checken.
    const transporter = buildTransporter();
    if (transporter && process.env.OWNER_EMAIL) {
      const pakketNaam = reactie.pakket ? PROJEXA_PAKKETTEN[reactie.pakket].naam : 'geen';
      transporter
        .sendMail({
          from: process.env.MAIL_FROM || 'Projexa <no-reply@aannemerscode.nl>',
          to: process.env.OWNER_EMAIL,
          subject: `Projexa: nieuwe reactie (${reactie.gebruik}, ${reactie.bedrag})`,
          text:
            `Zou gebruiken: ${reactie.gebruik}\n` +
            `Wil betalen: ${reactie.bedrag}\n` +
            `Pakket: ${pakketNaam}\n` +
            `Verbouwt: ${reactie.wanneer || 'niet ingevuld'}\n` +
            `E-mail: ${reactie.email || 'niet achtergelaten'}\n\n` +
            `Opmerking:\n${reactie.opmerking || '—'}\n\n` +
            `Totaal aantal reacties: ${data.aanmeldingen.length}`,
        })
        .catch((err) => console.error('Projexa-melding mailen mislukt:', err));
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error('Projexa-aanmelding mislukt:', err);
    return res.status(500).json({ error: 'Kon je antwoord niet opslaan.' });
  }
});

// Resultaten bekijken. Beveiligd met een sleutel uit .env, want hier staan
// e-mailadressen in. Zonder PROJEXA_SLEUTEL is dit endpoint dicht.
app.get('/api/projexa/resultaten', (req, res) => {
  const sleutel = process.env.PROJEXA_SLEUTEL;
  if (!sleutel) {
    return res.status(503).json({ error: 'Stel eerst PROJEXA_SLEUTEL in bij je omgevingsvariabelen.' });
  }
  if (req.query.sleutel !== sleutel) {
    return res.status(401).json({ error: 'Onjuiste sleutel.' });
  }

  const data = readProjexa();
  const tel = (lijst, veld) =>
    lijst.reduce((totaal, item) => {
      const waarde = item[veld] || 'onbekend';
      totaal[waarde] = (totaal[waarde] || 0) + 1;
      return totaal;
    }, {});

  const bezoekers = new Set(data.bezoeken.map((b) => b.bezoeker)).size;
  const klikkers = new Set(data.prijsklikken.map((k) => k.bezoeker)).size;

  return res.json({
    bezoeken: data.bezoeken.length,
    bezoekers,
    klikkers,
    aanmeldingen: data.aanmeldingen.length,
    metEmail: data.aanmeldingen.filter((a) => a.email).length,
    prijsklikken: tel(data.prijsklikken, 'pakket'),
    pakket: tel(data.aanmeldingen, 'pakket'),
    gebruik: tel(data.aanmeldingen, 'gebruik'),
    bedrag: tel(data.aanmeldingen, 'bedrag'),
    wanneer: tel(data.aanmeldingen, 'wanneer'),
    verwijzers: tel(data.bezoeken, 'verwijzer'),
    reacties: data.aanmeldingen.slice().reverse(),
  });
});

app.listen(PORT, () => {
  console.log(`AannemersCode webshop draait op ${BASE_URL}`);
});
