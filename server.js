require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const nodemailer = require('nodemailer');
const { createMollieClient } = require('@mollie/api-client');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

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
  if (!transporter) {
    console.log(
      `[mail overgeslagen] Geen SMTP ingesteld. Zou nu de download voor "${product.name}" hebben gestuurd naar ${order.email}.`
    );
    return;
  }
  const downloadLine = product.downloadUrl
    ? `Download hier: ${product.downloadUrl}`
    : 'Je downloadlink volgt zo — er is nog geen DOWNLOAD_URL ingesteld voor dit product.';

  await transporter.sendMail({
    from: process.env.MAIL_FROM || 'AannemersCode <no-reply@aannemerscode.nl>',
    to: order.email,
    subject: `Je bestelling: ${product.name}`,
    text: `Bedankt voor je bestelling van ${product.name}.\n\n${downloadLine}\n\nOrdernummer: ${order.id}`,
  });

  if (process.env.OWNER_EMAIL) {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || 'AannemersCode <no-reply@aannemerscode.nl>',
      to: process.env.OWNER_EMAIL,
      subject: `Nieuwe verkoop: ${product.name}`,
      text: `${order.email} heeft ${product.name} gekocht voor €${product.price}. Order: ${order.id}`,
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
    const { productId, email } = req.body;
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

app.listen(PORT, () => {
  console.log(`AannemersCode webshop draait op ${BASE_URL}`);
});
