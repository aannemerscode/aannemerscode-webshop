'use strict';

/**
 * Projexa — opslag van foto's
 *
 * De bytes van een foto horen niet in de database en niet op de schijf van de
 * webserver: bij honderden foto's per project loopt die vol, en op Render is
 * hij bij een herstart weg. Daarom gaat alles naar objectopslag (Cloudflare R2
 * of S3), en staat in de database alleen de sleutel.
 *
 * Instellen via omgevingsvariabelen:
 *
 *   S3_ENDPOINT    https://<account>.r2.cloudflarestorage.com   (R2)
 *   S3_BUCKET      projexa
 *   S3_REGION      auto                                          (R2: auto)
 *   S3_KEY         de access key id
 *   S3_SECRET      de secret access key
 *
 * Zolang die niet ingevuld zijn, weigert de app foto's aan te nemen met een
 * duidelijke melding — behalve als je expliciet PROJEXA_OPSLAG=lokaal zet.
 * Die stand is er om te kunnen ontwikkelen en proefdraaien; gebruik hem niet
 * voor echte klanten.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOKAAL_PAD = process.env.PROJEXA_FOTOMAP || path.join(__dirname, '..', 'data', 'fotos');

const S3 = {
  endpoint: process.env.S3_ENDPOINT || '',
  bucket: process.env.S3_BUCKET || '',
  region: process.env.S3_REGION || 'auto',
  key: process.env.S3_KEY || '',
  secret: process.env.S3_SECRET || '',
};

const s3Ingesteld = Boolean(S3.endpoint && S3.bucket && S3.key && S3.secret);
const lokaalToegestaan = process.env.PROJEXA_OPSLAG === 'lokaal';

let client = null;
let PutObjectCommand;
let GetObjectCommand;
let getSignedUrl;

if (s3Ingesteld) {
  const sdk = require('@aws-sdk/client-s3');
  ({ PutObjectCommand, GetObjectCommand } = sdk);
  ({ getSignedUrl } = require('@aws-sdk/s3-request-presigner'));

  client = new sdk.S3Client({
    endpoint: S3.endpoint,
    region: S3.region,
    credentials: { accessKeyId: S3.key, secretAccessKey: S3.secret },
    forcePathStyle: true, // R2 en de meeste S3-alternatieven willen dit
  });
}

if (!s3Ingesteld && lokaalToegestaan) {
  fs.mkdirSync(LOKAAL_PAD, { recursive: true });
  console.warn(
    '[Projexa] Foto\'s worden lokaal opgeslagen in ' + LOKAAL_PAD + '. ' +
    'Dit is alleen bedoeld om te ontwikkelen — zet S3_ENDPOINT, S3_BUCKET, S3_KEY en S3_SECRET ' +
    'voordat er echte projecten op draaien.'
  );
} else if (!s3Ingesteld) {
  console.warn(
    '[Projexa] Er is nog geen fotoopslag ingesteld. Foto\'s uploaden geeft een foutmelding ' +
    'totdat S3_ENDPOINT, S3_BUCKET, S3_KEY en S3_SECRET zijn ingevuld.'
  );
}

/** Is er ergens plek om foto's neer te zetten? */
function beschikbaar() {
  return s3Ingesteld || lokaalToegestaan;
}

function watIsErMis() {
  return 'Foto\'s opslaan is nog niet ingesteld. Vul S3_ENDPOINT, S3_BUCKET, S3_KEY en S3_SECRET in.';
}

/** Sleutel per project, met een willekeurig deel zodat namen nooit botsen. */
function nieuweSleutel(projectId, bestandsnaam) {
  const ext = (path.extname(bestandsnaam || '') || '.jpg').toLowerCase().slice(0, 6);
  return `projecten/${projectId}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
}

async function bewaar(sleutel, bytes, type) {
  if (s3Ingesteld) {
    await client.send(
      new PutObjectCommand({ Bucket: S3.bucket, Key: sleutel, Body: bytes, ContentType: type })
    );
    return;
  }

  if (!lokaalToegestaan) throw new Error(watIsErMis());

  const doel = path.join(LOKAAL_PAD, sleutel);
  fs.mkdirSync(path.dirname(doel), { recursive: true });
  fs.writeFileSync(doel, bytes);
}

/**
 * Adres waarmee de browser de foto ophaalt. Bij S3 een ondertekende link die
 * na een uur vervalt: de bucket blijft dus dicht en foto's van een verbouwing
 * zwerven niet rond op een openbare URL.
 */
async function leesAdres(sleutel) {
  if (s3Ingesteld) {
    return getSignedUrl(client, new GetObjectCommand({ Bucket: S3.bucket, Key: sleutel }), {
      expiresIn: 3600,
    });
  }
  return null; // lokaal: de server levert de bytes zelf uit
}

function lokaalBestand(sleutel) {
  if (s3Ingesteld || !lokaalToegestaan) return null;
  const doel = path.join(LOKAAL_PAD, sleutel);
  // Voorkomt dat een verzonnen sleutel met ../ buiten de fotomap wijst.
  if (!doel.startsWith(path.resolve(LOKAAL_PAD))) return null;
  return fs.existsSync(doel) ? doel : null;
}

module.exports = {
  beschikbaar,
  watIsErMis,
  nieuweSleutel,
  bewaar,
  leesAdres,
  lokaalBestand,
  gebruiktS3: () => s3Ingesteld,
};
