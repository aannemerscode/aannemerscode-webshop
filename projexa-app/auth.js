'use strict';

/**
 * Projexa — wachtwoorden, sessies en toegangscontrole
 *
 * Wachtwoorden gaan door scrypt met een eigen salt per wachtwoord; er staat
 * dus nergens een leesbaar wachtwoord in de database. Sessies zijn een
 * willekeurig token in een httpOnly-cookie, met een rij in de database
 * ernaast — uitloggen betekent die rij weggooien, en dan is de cookie waardeloos.
 */

const crypto = require('crypto');
const { db } = require('./db');

const COOKIE = 'projexa_sessie';
const SESSIE_DAGEN = 30;

/* -------------------------------------------------------------------------
   Wachtwoorden
   ------------------------------------------------------------------------- */

function hashWachtwoord(wachtwoord) {
  const salt = crypto.randomBytes(16).toString('hex');
  const sleutel = crypto.scryptSync(wachtwoord, salt, 64).toString('hex');
  return `scrypt$${salt}$${sleutel}`;
}

function klopWachtwoord(wachtwoord, opgeslagen) {
  const delen = String(opgeslagen || '').split('$');
  if (delen.length !== 3 || delen[0] !== 'scrypt') return false;

  const sleutel = Buffer.from(delen[2], 'hex');
  let kandidaat;
  try {
    kandidaat = crypto.scryptSync(wachtwoord, delen[1], sleutel.length);
  } catch {
    return false;
  }
  // Vaste-tijdvergelijking: anders kun je aan de reactietijd aflezen hoeveel
  // tekens er klopten.
  return sleutel.length === kandidaat.length && crypto.timingSafeEqual(sleutel, kandidaat);
}

/* -------------------------------------------------------------------------
   Codes voor uitgenodigde bedrijven
   ------------------------------------------------------------------------- */

// Zonder I, O, 0 en 1 — die worden telefonisch en op papier door elkaar gehaald.
const TEKENS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function sleutel(lengte) {
  const bytes = crypto.randomBytes(lengte);
  let uit = '';
  for (let i = 0; i < lengte; i++) uit += TEKENS[bytes[i] % TEKENS.length];
  return uit;
}

/** Projectcode die uniek is binnen de hele database. */
function nieuweCode() {
  const bestaat = db.prepare('SELECT 1 FROM deelnemers WHERE code = ?');
  for (let poging = 0; poging < 20; poging++) {
    const code = `PRJ-${sleutel(4)}`;
    if (!bestaat.get(code)) return code;
  }
  return `PRJ-${sleutel(7)}`;
}

function nieuwWachtwoord() {
  return `${sleutel(4)}-${sleutel(4)}-${sleutel(4)}`;
}

function nieuwId(voorvoegsel) {
  return `${voorvoegsel}_${crypto.randomBytes(9).toString('base64url')}`;
}

/* -------------------------------------------------------------------------
   Sessies
   ------------------------------------------------------------------------- */

function startSessie(res, soort, persoonId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const nu = new Date();
  const verloopt = new Date(nu.getTime() + SESSIE_DAGEN * 24 * 60 * 60 * 1000);

  db.prepare(
    'INSERT INTO sessies (token, soort, persoon_id, aangemaakt_op, verloopt_op) VALUES (?, ?, ?, ?, ?)'
  ).run(token, soort, persoonId, nu.toISOString(), verloopt.toISOString());

  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSIE_DAGEN * 24 * 60 * 60 * 1000,
    path: '/',
  });

  return token;
}

function beeindigSessie(req, res) {
  const token = req.cookies && req.cookies[COOKIE];
  if (token) db.prepare('DELETE FROM sessies WHERE token = ?').run(token);
  res.clearCookie(COOKIE, { path: '/' });
}

/** Leest de sessie uit de cookie. Geeft null als er geen geldige sessie is. */
function huidigeSessie(req) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) return null;

  const sessie = db.prepare('SELECT * FROM sessies WHERE token = ?').get(token);
  if (!sessie) return null;

  if (sessie.verloopt_op < new Date().toISOString()) {
    db.prepare('DELETE FROM sessies WHERE token = ?').run(token);
    return null;
  }

  if (sessie.soort === 'eigenaar') {
    const eigenaar = db
      .prepare('SELECT id, naam, email FROM eigenaren WHERE id = ?')
      .get(sessie.persoon_id);
    return eigenaar ? { soort: 'eigenaar', eigenaar } : null;
  }

  const deelnemer = db.prepare('SELECT * FROM deelnemers WHERE id = ?').get(sessie.persoon_id);
  return deelnemer ? { soort: 'deelnemer', deelnemer } : null;
}

/* -------------------------------------------------------------------------
   Poortwachters
   ------------------------------------------------------------------------- */

function alleenEigenaar(req, res, volgende) {
  const sessie = huidigeSessie(req);
  if (!sessie) return res.status(401).json({ fout: 'Log eerst in.' });
  if (sessie.soort !== 'eigenaar') {
    // Wél ingelogd, maar als uitgenodigd bedrijf: dan is dit gewoon niet aan hem.
    return res.status(403).json({ fout: 'Alleen de eigenaar van het project kan dit doen.' });
  }
  req.eigenaar = sessie.eigenaar;
  volgende();
}

function alleenDeelnemer(req, res, volgende) {
  const sessie = huidigeSessie(req);
  if (!sessie) return res.status(401).json({ fout: 'Log eerst in met je projectcode.' });
  if (sessie.soort !== 'deelnemer') {
    return res.status(403).json({ fout: 'Dit is bedoeld voor uitgenodigde bedrijven.' });
  }
  req.deelnemer = sessie.deelnemer;
  volgende();
}

/**
 * Haalt het project op en controleert dat het van de ingelogde eigenaar is.
 * Een onbekend project en het project van iemand anders geven allebei 404,
 * zodat je niet kunt aftasten welke projecten bestaan.
 */
function projectVanEigenaar(projectId, eigenaarId) {
  return db
    .prepare('SELECT * FROM projecten WHERE id = ? AND eigenaar_id = ?')
    .get(projectId, eigenaarId);
}

/* -------------------------------------------------------------------------
   Inlogpogingen afremmen
   ------------------------------------------------------------------------- */

// Simpele teller in het geheugen: genoeg om geautomatiseerd raden te stoppen.
// Bij meerdere servers of een herstart begint de teller opnieuw; dat is voor
// deze schaal een prima ruil.
const pogingen = new Map();
const MAX_POGINGEN = 8;
const VENSTER_MS = 10 * 60 * 1000;

function magNogProberen(sleutelnaam) {
  const nu = Date.now();
  const rij = pogingen.get(sleutelnaam);
  if (!rij || nu - rij.sinds > VENSTER_MS) {
    pogingen.set(sleutelnaam, { aantal: 0, sinds: nu });
    return true;
  }
  return rij.aantal < MAX_POGINGEN;
}

function telMisluktePoging(sleutelnaam) {
  const rij = pogingen.get(sleutelnaam);
  if (rij) rij.aantal += 1;
}

function wisPogingen(sleutelnaam) {
  pogingen.delete(sleutelnaam);
}

module.exports = {
  COOKIE,
  hashWachtwoord,
  klopWachtwoord,
  nieuweCode,
  nieuwWachtwoord,
  nieuwId,
  startSessie,
  beeindigSessie,
  huidigeSessie,
  alleenEigenaar,
  alleenDeelnemer,
  projectVanEigenaar,
  magNogProberen,
  telMisluktePoging,
  wisPogingen,
};
