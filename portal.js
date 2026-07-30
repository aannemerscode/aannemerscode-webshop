// ---------------------------------------------------------------------------
// Projexa — projectportaal van AannemersCode
//
// Eén overzichtelijke plek per bouwproject, voor klant én bedrijf:
//  - Het bedrijf maakt per project een unieke inlog aan (projectcode + wachtwoord).
//  - De klant logt daarmee in en ziet uitsluitend zíjn eigen project — niets anders.
//  - Wijzigingen/meerwerk worden vastgelegd en digitaal goedgekeurd vóór de uitvoering,
//    zodat discussies achteraf ("dat zat toch in de offerte?") niet meer nodig zijn.
//  - Planning, updates, documenten/foto's en berichten staan in één projectdossier.
//
// Opslag: data/portal.json (zelfde aanpak als orders.json — prima voor de start,
// vervang door een echte database zodra het volume groeit of je serverless draait).
// ---------------------------------------------------------------------------

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const webpush = require('web-push');
const nodemailer = require('nodemailer');
const Anthropic = require('@anthropic-ai/sdk');

// ---------- AI (Claude) ----------
// Zet ANTHROPIC_API_KEY in .env om de AI-functies te activeren: automatische
// fotosamenvattingen, de AI-schrijfhulp (dagrapport/klantupdate/werkbon/
// conceptfactuur/opleverrapport) en dagrapporten van werknemers.
const AI_MODEL = 'claude-opus-5';
const aiClient = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
if (!aiClient) {
  console.warn('[portaal] ANTHROPIC_API_KEY ontbreekt — AI-functies (fotosamenvatting, schrijfhulp) staan uit.');
}

async function aiTekst({ system, prompt, maxTokens = 2048, effort }) {
  if (!aiClient) throw new Error('AI is niet ingesteld. Zet ANTHROPIC_API_KEY in de omgeving.');
  const response = await aiClient.messages.create({
    model: AI_MODEL,
    max_tokens: maxTokens,
    ...(effort ? { output_config: { effort } } : {}),
    system,
    messages: [{ role: 'user', content: prompt }],
  });
  if (response.stop_reason === 'refusal') throw new Error('De AI kon dit verzoek niet verwerken.');
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

const router = express.Router();

const PORTAL_FILE = path.join(__dirname, 'data', 'portal.json');
const UPLOADS_DIR = path.join(__dirname, 'data', 'uploads');
const VAPID_FILE = path.join(__dirname, 'data', 'vapid.json');

// ---------- Opslag ----------
function ensurePortalFiles() {
  const dir = path.dirname(PORTAL_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(PORTAL_FILE)) fs.writeFileSync(PORTAL_FILE, JSON.stringify({ projects: {} }, null, 2));
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
ensurePortalFiles();

function readPortal() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(PORTAL_FILE, 'utf8'));
  } catch {
    data = {};
  }
  if (!data.projects) data.projects = {};
  if (!data.werknemers) data.werknemers = {};
  if (!data.uren) data.uren = {};
  if (!data.taken) data.taken = {};
  if (!data.meta) data.meta = {};
  return data;
}
function writePortal(data) {
  fs.writeFileSync(PORTAL_FILE, JSON.stringify(data, null, 2));
}

// ---------- Geheimen & wachtwoorden ----------
// SESSION_SECRET in .env zorgt dat inlogsessies een herstart overleven.
// Zonder die variabele wordt er per start een tijdelijk geheim gegenereerd
// (iedereen moet dan na een herstart opnieuw inloggen — verder geen kwaad).
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('[portaal] SESSION_SECRET ontbreekt in .env — sessies vervallen bij elke herstart van de server.');
}

// Wachtwoord voor het bedrijfsdashboard (/beheer.html). Zonder ADMIN_WACHTWOORD
// in .env wordt er bij het opstarten een tijdelijk wachtwoord gegenereerd en in
// de serverlog getoond, zodat het portaal nooit onbeveiligd openstaat.
let ADMIN_PASSWORD = process.env.ADMIN_WACHTWOORD || process.env.ADMIN_PASSWORD || '';
if (!ADMIN_PASSWORD) {
  ADMIN_PASSWORD = crypto.randomBytes(9).toString('base64url');
  console.warn(
    `[portaal] ADMIN_WACHTWOORD ontbreekt in .env — tijdelijk beheerwachtwoord voor deze sessie: ${ADMIN_PASSWORD}\n` +
    '[portaal] Zet ADMIN_WACHTWOORD in .env (of Render → Environment) voor een vast wachtwoord.'
  );
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function verifyPassword(password, salt, expectedHash) {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// Leesbare, unieke projectcode zoals "PRJ-K7M4" — dit is de "gebruikersnaam" van de klant.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // zonder 0/O/1/I — voorkomt verwarring
function randomFromAlphabet(len) {
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}
function newProjectCode(projects) {
  for (let i = 0; i < 50; i++) {
    const code = `PRJ-${randomFromAlphabet(4)}`;
    const taken = Object.values(projects).some((p) => p.code === code);
    if (!taken) return code;
  }
  return `PRJ-${randomFromAlphabet(8)}`; // vrijwel onbereikbaar, maar altijd uniek
}
function newWerknemerCode(werknemers) {
  for (let i = 0; i < 50; i++) {
    const code = `WRK-${randomFromAlphabet(4)}`;
    const taken = Object.values(werknemers).some((w) => w.code === code);
    if (!taken) return code;
  }
  return `WRK-${randomFromAlphabet(8)}`;
}
function newClientPassword() {
  // Formaat XXXX-XXXX-XXXX: goed voor te lezen aan de telefoon, sterk genoeg (32^12).
  return `${randomFromAlphabet(4)}-${randomFromAlphabet(4)}-${randomFromAlphabet(4)}`;
}
function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

// ---------- Sessietokens (HMAC-ondertekend, in een httpOnly-cookie) ----------
const COOKIE_NAME = 'ac_portaal';
const SESSION_HOURS = 12;

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}
function setSessionCookie(res, payload) {
  const token = signToken({ ...payload, exp: Date.now() + SESSION_HOURS * 3600 * 1000 });
  const secure = (process.env.BASE_URL || '').startsWith('https') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}
function getSession(req) {
  return verifyToken(parseCookies(req)[COOKIE_NAME]);
}

// Middleware: alleen het bedrijf
function requireAdmin(req, res, next) {
  const session = getSession(req);
  if (!session || session.rol !== 'bedrijf') {
    return res.status(401).json({ error: 'Niet ingelogd als bedrijf.' });
  }
  req.session = session;
  next();
}
// Middleware: alleen een ingelogde klant — en die kan uitsluitend bij zijn eigen project.
// Het project-id komt altijd uit de sessie, nooit uit de URL of het verzoek zelf.
function requireKlant(req, res, next) {
  const session = getSession(req);
  if (!session || session.rol !== 'klant' || !session.projectId) {
    return res.status(401).json({ error: 'Niet ingelogd.' });
  }
  const data = readPortal();
  const project = data.projects[session.projectId];
  if (!project) return res.status(401).json({ error: 'Project bestaat niet meer.' });
  req.session = session;
  req.portalData = data;
  req.project = project;
  next();
}

// Middleware: alleen een ingelogde werknemer.
function requireWerknemer(req, res, next) {
  const session = getSession(req);
  if (!session || session.rol !== 'werknemer' || !session.werknemerId) {
    return res.status(401).json({ error: 'Niet ingelogd.' });
  }
  const data = readPortal();
  const werknemer = data.werknemers[session.werknemerId];
  if (!werknemer) return res.status(401).json({ error: 'Account bestaat niet meer.' });
  req.session = session;
  req.portalData = data;
  req.werknemer = werknemer;
  next();
}

// ---------- Simpele bruteforce-rem op inlogpogingen ----------
const loginAttempts = new Map(); // sleutel -> { count, tot }
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
function tooManyAttempts(key) {
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (Date.now() > entry.tot) {
    loginAttempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}
function registerAttempt(key) {
  const entry = loginAttempts.get(key);
  if (!entry || Date.now() > entry.tot) {
    loginAttempts.set(key, { count: 1, tot: Date.now() + ATTEMPT_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

// ---------- Weergave voor de klant (zonder gevoelige velden) ----------
function projectVoorKlant(project) {
  const { wachtwoordHash, wachtwoordSalt, ...rest } = project;
  return rest;
}

// ===========================================================================
// KLANT-ROUTES  (/api/portaal/klant/...)
// ===========================================================================

router.post('/api/portaal/klant/login', (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const wachtwoord = String(req.body.wachtwoord || '').trim().toUpperCase();
  if (!code || !wachtwoord) return res.status(400).json({ error: 'Vul projectcode én wachtwoord in.' });

  const attemptKey = `klant:${req.ip}:${code}`;
  if (tooManyAttempts(attemptKey)) {
    return res.status(429).json({ error: 'Te veel inlogpogingen. Probeer het over een kwartier opnieuw.' });
  }

  const data = readPortal();
  const project = Object.values(data.projects).find((p) => p.code === code);
  if (!project || !verifyPassword(wachtwoord, project.wachtwoordSalt, project.wachtwoordHash)) {
    registerAttempt(attemptKey);
    return res.status(401).json({ error: 'Projectcode of wachtwoord klopt niet.' });
  }

  loginAttempts.delete(attemptKey);
  setSessionCookie(res, { rol: 'klant', projectId: project.id });
  res.json({ ok: true });
});

router.post('/api/portaal/klant/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Het eigen project — het enige dat een klant ooit te zien krijgt.
router.get('/api/portaal/klant/project', requireKlant, (req, res) => {
  res.json({ project: projectVoorKlant(req.project) });
});

// Digitale goedkeuring/afwijzing van meerwerk door de klant.
router.post('/api/portaal/klant/meerwerk/:meerwerkId/besluit', requireKlant, (req, res) => {
  const besluit = req.body.besluit;
  if (!['goedgekeurd', 'afgewezen'].includes(besluit)) {
    return res.status(400).json({ error: 'Besluit moet "goedgekeurd" of "afgewezen" zijn.' });
  }
  const item = (req.project.meerwerk || []).find((m) => m.id === req.params.meerwerkId);
  if (!item) return res.status(404).json({ error: 'Meerwerk niet gevonden.' });
  if (item.status !== 'wacht_op_klant') {
    return res.status(400).json({ error: 'Dit meerwerk is al beoordeeld.' });
  }
  item.status = besluit;
  item.besluitOp = new Date().toISOString();
  writePortal(req.portalData);
  res.json({ ok: true, meerwerk: item });
});

// Klant stuurt een bericht/vraag — geen telefoontje nodig.
router.post('/api/portaal/klant/bericht', requireKlant, (req, res) => {
  const tekst = String(req.body.tekst || '').trim();
  if (!tekst) return res.status(400).json({ error: 'Bericht is leeg.' });
  if (tekst.length > 4000) return res.status(400).json({ error: 'Bericht is te lang (max 4000 tekens).' });
  req.project.berichten = req.project.berichten || [];
  const bericht = { id: newId('msg'), van: 'klant', tekst, op: new Date().toISOString() };
  req.project.berichten.push(bericht);
  writePortal(req.portalData);
  res.json({ ok: true, bericht });
});

// ===========================================================================
// BEDRIJFS-ROUTES  (/api/portaal/beheer/...)
// ===========================================================================

router.post('/api/portaal/beheer/login', (req, res) => {
  const attemptKey = `beheer:${req.ip}`;
  if (tooManyAttempts(attemptKey)) {
    return res.status(429).json({ error: 'Te veel inlogpogingen. Probeer het over een kwartier opnieuw.' });
  }
  const wachtwoord = String(req.body.wachtwoord || '');
  const a = Buffer.from(wachtwoord);
  const b = Buffer.from(ADMIN_PASSWORD);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    registerAttempt(attemptKey);
    return res.status(401).json({ error: 'Wachtwoord klopt niet.' });
  }
  loginAttempts.delete(attemptKey);
  setSessionCookie(res, { rol: 'bedrijf' });
  res.json({ ok: true });
});

router.post('/api/portaal/beheer/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Overzicht van alle projecten, met telwerk voor het dashboard.
router.get('/api/portaal/beheer/projecten', requireAdmin, (req, res) => {
  const data = readPortal();
  const projecten = Object.values(data.projects)
    .map((p) => ({
      id: p.id,
      code: p.code,
      naam: p.naam,
      klantNaam: p.klantNaam,
      adres: p.adres,
      status: p.status,
      aangemaaktOp: p.aangemaaktOp,
      openMeerwerk: (p.meerwerk || []).filter((m) => m.status === 'wacht_op_klant').length,
      klantBerichten: (p.berichten || []).filter((m) => m.van === 'klant').length,
    }))
    .sort((a, b) => (b.aangemaaktOp || '').localeCompare(a.aangemaaktOp || ''));
  res.json({ projecten });
});

// Nieuw project aanmaken → genereert direct de unieke klant-inlog.
// Het wachtwoord wordt éénmalig teruggegeven (we bewaren alleen de hash);
// daarna kan het alleen nog opnieuw gegenereerd worden.
router.post('/api/portaal/beheer/projecten', requireAdmin, (req, res) => {
  const naam = String(req.body.naam || '').trim();
  const klantNaam = String(req.body.klantNaam || '').trim();
  if (!naam || !klantNaam) {
    return res.status(400).json({ error: 'Projectnaam en klantnaam zijn verplicht.' });
  }

  const data = readPortal();
  const code = newProjectCode(data.projects);
  const wachtwoord = newClientPassword();
  const salt = crypto.randomBytes(16).toString('hex');

  const project = {
    id: newId('prj'),
    code,
    naam,
    klantNaam,
    klantEmail: String(req.body.klantEmail || '').trim(),
    klantTelefoon: String(req.body.klantTelefoon || '').trim(),
    adres: String(req.body.adres || '').trim(),
    omschrijving: String(req.body.omschrijving || '').trim(),
    startDatum: String(req.body.startDatum || '').trim(),
    opleverDatum: String(req.body.opleverDatum || '').trim(),
    status: 'voorbereiding',
    aangemaaktOp: new Date().toISOString(),
    wachtwoordSalt: salt,
    wachtwoordHash: hashPassword(wachtwoord, salt),
    fases: [],
    updates: [],
    meerwerk: [],
    documenten: [],
    berichten: [],
  };

  data.projects[project.id] = project;
  writePortal(data);

  res.json({
    ok: true,
    project: projectVoorKlant(project),
    inlog: { code, wachtwoord, url: `${process.env.BASE_URL || ''}/portaal.html` },
  });
});

function findProject(req, res) {
  const data = readPortal();
  const project = data.projects[req.params.projectId];
  if (!project) {
    res.status(404).json({ error: 'Project niet gevonden.' });
    return null;
  }
  return { data, project };
}

router.get('/api/portaal/beheer/projecten/:projectId', requireAdmin, (req, res) => {
  const found = findProject(req, res);
  if (!found) return;
  res.json({ project: projectVoorKlant(found.project) });
});

// Algemene projectvelden bijwerken (status, data, omschrijving, klantgegevens).
router.patch('/api/portaal/beheer/projecten/:projectId', requireAdmin, (req, res) => {
  const found = findProject(req, res);
  if (!found) return;
  const { data, project } = found;

  const toegestaneVelden = ['naam', 'klantNaam', 'klantEmail', 'klantTelefoon', 'adres', 'omschrijving', 'startDatum', 'opleverDatum'];
  for (const veld of toegestaneVelden) {
    if (veld in req.body) project[veld] = String(req.body[veld] || '').trim();
  }
  if ('status' in req.body) {
    if (!['voorbereiding', 'in_uitvoering', 'opgeleverd'].includes(req.body.status)) {
      return res.status(400).json({ error: 'Ongeldige status.' });
    }
    project.status = req.body.status;
  }
  writePortal(data);
  res.json({ ok: true, project: projectVoorKlant(project) });
});

router.delete('/api/portaal/beheer/projecten/:projectId', requireAdmin, (req, res) => {
  const found = findProject(req, res);
  if (!found) return;
  delete found.data.projects[req.params.projectId];
  writePortal(found.data);
  const uploadDir = path.join(UPLOADS_DIR, req.params.projectId);
  if (fs.existsSync(uploadDir)) fs.rmSync(uploadDir, { recursive: true, force: true });
  res.json({ ok: true });
});

// Nieuw klantwachtwoord genereren (bv. als de klant het kwijt is).
router.post('/api/portaal/beheer/projecten/:projectId/reset-wachtwoord', requireAdmin, (req, res) => {
  const found = findProject(req, res);
  if (!found) return;
  const { data, project } = found;
  const wachtwoord = newClientPassword();
  project.wachtwoordSalt = crypto.randomBytes(16).toString('hex');
  project.wachtwoordHash = hashPassword(wachtwoord, project.wachtwoordSalt);
  writePortal(data);
  res.json({ ok: true, inlog: { code: project.code, wachtwoord } });
});

// --- Fases (de planning die de klant ziet) ---
router.post('/api/portaal/beheer/projecten/:projectId/fases', requireAdmin, (req, res) => {
  const found = findProject(req, res);
  if (!found) return;
  const naam = String(req.body.naam || '').trim();
  if (!naam) return res.status(400).json({ error: 'Fasenaam is verplicht.' });
  const fase = {
    id: newId('fase'),
    naam,
    status: 'gepland',
    start: String(req.body.start || '').trim(),
    eind: String(req.body.eind || '').trim(),
    notitie: String(req.body.notitie || '').trim(),
  };
  found.project.fases = found.project.fases || [];
  found.project.fases.push(fase);
  writePortal(found.data);
  res.json({ ok: true, fase });
});

router.patch('/api/portaal/beheer/projecten/:projectId/fases/:faseId', requireAdmin, (req, res) => {
  const found = findProject(req, res);
  if (!found) return;
  const fase = (found.project.fases || []).find((f) => f.id === req.params.faseId);
  if (!fase) return res.status(404).json({ error: 'Fase niet gevonden.' });
  for (const veld of ['naam', 'start', 'eind', 'notitie']) {
    if (veld in req.body) fase[veld] = String(req.body[veld] || '').trim();
  }
  if ('status' in req.body) {
    if (!['gepland', 'bezig', 'afgerond'].includes(req.body.status)) {
      return res.status(400).json({ error: 'Ongeldige fasestatus.' });
    }
    fase.status = req.body.status;
  }
  writePortal(found.data);
  res.json({ ok: true, fase });
});

router.delete('/api/portaal/beheer/projecten/:projectId/fases/:faseId', requireAdmin, (req, res) => {
  const found = findProject(req, res);
  if (!found) return;
  found.project.fases = (found.project.fases || []).filter((f) => f.id !== req.params.faseId);
  writePortal(found.data);
  res.json({ ok: true });
});

// --- Voortgangsupdates (houden de klant op de hoogte, dus minder telefoontjes) ---
router.post('/api/portaal/beheer/projecten/:projectId/updates', requireAdmin, (req, res) => {
  const found = findProject(req, res);
  if (!found) return;
  const tekst = String(req.body.tekst || '').trim();
  if (!tekst) return res.status(400).json({ error: 'Update is leeg.' });
  const update = { id: newId('upd'), tekst, op: new Date().toISOString() };
  found.project.updates = found.project.updates || [];
  found.project.updates.unshift(update);
  writePortal(found.data);
  res.json({ ok: true, update });
});

// --- Meerwerk: vastleggen → klant keurt digitaal goed vóór uitvoering ---
router.post('/api/portaal/beheer/projecten/:projectId/meerwerk', requireAdmin, (req, res) => {
  const found = findProject(req, res);
  if (!found) return;
  const titel = String(req.body.titel || '').trim();
  const bedrag = Number(req.body.bedrag);
  if (!titel) return res.status(400).json({ error: 'Omschrijf het meerwerk kort in de titel.' });
  if (!Number.isFinite(bedrag) || bedrag < 0) return res.status(400).json({ error: 'Vul een geldig bedrag in.' });
  const item = {
    id: newId('mw'),
    titel,
    omschrijving: String(req.body.omschrijving || '').trim(),
    bedrag: Math.round(bedrag * 100) / 100,
    status: 'wacht_op_klant',
    aangemaaktOp: new Date().toISOString(),
    besluitOp: null,
  };
  found.project.meerwerk = found.project.meerwerk || [];
  found.project.meerwerk.unshift(item);
  writePortal(found.data);
  res.json({ ok: true, meerwerk: item });
});

router.delete('/api/portaal/beheer/projecten/:projectId/meerwerk/:meerwerkId', requireAdmin, (req, res) => {
  const found = findProject(req, res);
  if (!found) return;
  found.project.meerwerk = (found.project.meerwerk || []).filter((m) => m.id !== req.params.meerwerkId);
  writePortal(found.data);
  res.json({ ok: true });
});

// --- Documenten: links (offerte, tekening) of geüploade bestanden/foto's ---
router.post('/api/portaal/beheer/projecten/:projectId/documenten', requireAdmin, (req, res) => {
  const found = findProject(req, res);
  if (!found) return;
  const naam = String(req.body.naam || '').trim();
  const url = String(req.body.url || '').trim();
  if (!naam || !url) return res.status(400).json({ error: 'Naam en link zijn verplicht.' });
  const doc = {
    id: newId('doc'),
    naam,
    categorie: String(req.body.categorie || 'overig').trim(),
    url,
    toegevoegdOp: new Date().toISOString(),
  };
  found.project.documenten = found.project.documenten || [];
  found.project.documenten.unshift(doc);
  writePortal(found.data);
  res.json({ ok: true, document: doc });
});

// Bestand uploaden (foto's van de bouwplaats, PDF's). Ruwe upload, max 15 MB.
router.post(
  '/api/portaal/beheer/projecten/:projectId/upload',
  requireAdmin,
  express.raw({ type: '*/*', limit: '15mb' }),
  (req, res) => {
    const found = findProject(req, res);
    if (!found) return;
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Geen bestandsinhoud ontvangen.' });
    }
    const origineleNaam = String(req.query.filename || 'bestand').slice(0, 120);
    const veiligeNaam = origineleNaam.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileId = newId('file');
    const dir = path.join(UPLOADS_DIR, found.project.id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${fileId}__${veiligeNaam}`), req.body);

    const doc = {
      id: newId('doc'),
      naam: origineleNaam,
      categorie: String(req.query.categorie || 'foto').trim(),
      bestand: { fileId, naam: veiligeNaam, grootte: req.body.length, mime: req.headers['content-type'] || 'application/octet-stream' },
      toegevoegdOp: new Date().toISOString(),
    };
    found.project.documenten = found.project.documenten || [];
    found.project.documenten.unshift(doc);
    writePortal(found.data);
    res.json({ ok: true, document: doc });

    // AI-samenvatting van foto's en bonnetjes: draait op de achtergrond en wordt
    // bij het document opgeslagen zodra hij klaar is (zichtbaar na verversen).
    beschrijfFotoMetAi(found.project.id, doc).catch((err) =>
      console.error('[portaal] fotosamenvatting mislukt:', err.message)
    );
  }
);

async function beschrijfFotoMetAi(projectId, doc) {
  if (!aiClient) return;
  const mime = (doc.bestand && doc.bestand.mime) || '';
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime)) return;
  const pad = path.join(UPLOADS_DIR, projectId, `${doc.bestand.fileId}__${doc.bestand.naam}`);
  if (!fs.existsSync(pad)) return;

  const isBonnetje = doc.categorie === 'bonnetje';
  const response = await aiClient.messages.create({
    model: AI_MODEL,
    max_tokens: 1024,
    output_config: { effort: 'low' },
    system: isBonnetje
      ? 'Je leest bonnetjes voor de administratie van een Nederlands aannemersbedrijf. Antwoord in het Nederlands, kort en zakelijk.'
      : 'Je beschrijft bouwplaatsfoto\'s voor het projectdossier van een Nederlands aannemersbedrijf. Antwoord in het Nederlands, in één of twee zinnen, zakelijk en concreet (wat is er te zien, welke werkzaamheden of staat van het werk).',
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mime, data: fs.readFileSync(pad).toString('base64') } },
        { type: 'text', text: isBonnetje
            ? 'Lees dit bonnetje en geef terug: leverancier, datum en totaalbedrag (en btw als zichtbaar). Formaat: "Leverancier · datum · € bedrag". Als iets onleesbaar is, zeg dat.'
            : 'Beschrijf deze bouwfoto kort voor het projectdossier.' },
      ],
    }],
  });
  if (response.stop_reason === 'refusal') return;
  const tekst = response.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
  if (!tekst) return;

  const data = readPortal();
  const project = data.projects[projectId];
  if (!project) return;
  const bewaard = (project.documenten || []).find((d) => d.id === doc.id);
  if (!bewaard) return;
  bewaard.aiSamenvatting = tekst.slice(0, 600);
  writePortal(data);
}

router.delete('/api/portaal/beheer/projecten/:projectId/documenten/:docId', requireAdmin, (req, res) => {
  const found = findProject(req, res);
  if (!found) return;
  const doc = (found.project.documenten || []).find((d) => d.id === req.params.docId);
  if (doc && doc.bestand) {
    const bestandPad = path.join(UPLOADS_DIR, found.project.id, `${doc.bestand.fileId}__${doc.bestand.naam}`);
    if (fs.existsSync(bestandPad)) fs.unlinkSync(bestandPad);
  }
  found.project.documenten = (found.project.documenten || []).filter((d) => d.id !== req.params.docId);
  writePortal(found.data);
  res.json({ ok: true });
});

// --- Bericht van het bedrijf aan de klant ---
router.post('/api/portaal/beheer/projecten/:projectId/bericht', requireAdmin, (req, res) => {
  const found = findProject(req, res);
  if (!found) return;
  const tekst = String(req.body.tekst || '').trim();
  if (!tekst) return res.status(400).json({ error: 'Bericht is leeg.' });
  found.project.berichten = found.project.berichten || [];
  const bericht = { id: newId('msg'), van: 'bedrijf', tekst, op: new Date().toISOString() };
  found.project.berichten.push(bericht);
  writePortal(found.data);
  res.json({ ok: true, bericht });
});

// ===========================================================================
// BEVEILIGDE BESTANDEN
// Uploads staan bewust buiten /public — ze zijn alleen op te vragen door het
// bedrijf, of door de klant van precies dát project (check via de sessie).
// ===========================================================================
router.get('/api/portaal/bestand/:projectId/:fileId', (req, res) => {
  const session = getSession(req);
  const magKijken =
    session && (session.rol === 'bedrijf' || (session.rol === 'klant' && session.projectId === req.params.projectId));
  if (!magKijken) return res.status(401).json({ error: 'Geen toegang.' });

  const data = readPortal();
  const project = data.projects[req.params.projectId];
  if (!project) return res.status(404).json({ error: 'Project niet gevonden.' });
  const doc = (project.documenten || []).find((d) => d.bestand && d.bestand.fileId === req.params.fileId);
  if (!doc) return res.status(404).json({ error: 'Bestand niet gevonden.' });

  const bestandPad = path.join(UPLOADS_DIR, project.id, `${doc.bestand.fileId}__${doc.bestand.naam}`);
  if (!fs.existsSync(bestandPad)) return res.status(404).json({ error: 'Bestand niet gevonden.' });
  res.setHeader('Content-Type', doc.bestand.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${doc.bestand.naam}"`);
  fs.createReadStream(bestandPad).pipe(res);
});

// Sessiestatus (voor de frontends: welk scherm moeten we tonen?)
router.get('/api/portaal/sessie', (req, res) => {
  const session = getSession(req);
  if (!session) return res.json({ ingelogd: false });
  res.json({ ingelogd: true, rol: session.rol });
});

// ===========================================================================
// OPLEVERDOSSIER
// Het bedrijf vult per project de dossiergegevens in (garanties, onderhoud,
// cv/warmtepomp, dakinspectie); de klant krijgt na oplevering één compleet,
// printbaar document met daarbij de hele verbouwgeschiedenis.
// ===========================================================================
router.patch('/api/portaal/beheer/projecten/:projectId/dossier', requireAdmin, (req, res) => {
  const found = findProject(req, res);
  if (!found) return;
  const { data, project } = found;
  project.dossier = project.dossier || {};
  const d = project.dossier;

  if (Array.isArray(req.body.garanties)) {
    d.garanties = req.body.garanties.slice(0, 100).map((g) => ({
      onderdeel: String(g.onderdeel || '').trim().slice(0, 200),
      duur: String(g.duur || '').trim().slice(0, 100),
      toelichting: String(g.toelichting || '').trim().slice(0, 1000),
    })).filter((g) => g.onderdeel);
  }
  if (Array.isArray(req.body.onderhoud)) {
    d.onderhoud = req.body.onderhoud.slice(0, 100).map((o) => ({
      taak: String(o.taak || '').trim().slice(0, 200),
      frequentie: String(o.frequentie || '').trim().slice(0, 100),
      toelichting: String(o.toelichting || '').trim().slice(0, 1000),
    })).filter((o) => o.taak);
  }
  if (req.body.cvWarmtepomp && typeof req.body.cvWarmtepomp === 'object') {
    const c = req.body.cvWarmtepomp;
    d.cvWarmtepomp = {
      installatie: String(c.installatie || '').trim().slice(0, 200),
      laatsteOnderhoud: String(c.laatsteOnderhoud || '').trim().slice(0, 100),
      volgendeOnderhoud: String(c.volgendeOnderhoud || '').trim().slice(0, 100),
      toelichting: String(c.toelichting || '').trim().slice(0, 1000),
    };
  }
  if (req.body.dakinspectie && typeof req.body.dakinspectie === 'object') {
    const c = req.body.dakinspectie;
    d.dakinspectie = {
      laatsteInspectie: String(c.laatsteInspectie || '').trim().slice(0, 100),
      volgendeInspectie: String(c.volgendeInspectie || '').trim().slice(0, 100),
      bevindingen: String(c.bevindingen || '').trim().slice(0, 2000),
    };
  }
  if ('slotwoord' in req.body) d.slotwoord = String(req.body.slotwoord || '').trim().slice(0, 2000);

  writePortal(data);
  res.json({ ok: true, dossier: d });
});

// ===========================================================================
// WERKNEMERS  — apart inlogportaal met urenstaat (incl. meerwerkuren)
// ===========================================================================

// --- Beheer: werknemers aanmaken en overzien ---
router.get('/api/portaal/beheer/werknemers', requireAdmin, (req, res) => {
  const data = readPortal();
  const vandaag = amsterdamDatum();
  const werknemers = Object.values(data.werknemers).map((w) => ({
    id: w.id,
    code: w.code,
    naam: w.naam,
    email: w.email,
    aangemaaktOp: w.aangemaaktOp,
    pushActief: (w.pushSubs || []).length > 0,
    urenVandaagIngevuld: Object.values(data.uren).some((u) => u.werknemerId === w.id && u.datum === vandaag),
  })).sort((a, b) => a.naam.localeCompare(b.naam));
  res.json({ werknemers });
});

router.post('/api/portaal/beheer/werknemers', requireAdmin, (req, res) => {
  const naam = String(req.body.naam || '').trim();
  if (!naam) return res.status(400).json({ error: 'Naam is verplicht.' });
  const data = readPortal();
  const code = newWerknemerCode(data.werknemers);
  const wachtwoord = newClientPassword();
  const salt = crypto.randomBytes(16).toString('hex');
  const werknemer = {
    id: newId('wrk'),
    code,
    naam,
    email: String(req.body.email || '').trim(),
    wachtwoordSalt: salt,
    wachtwoordHash: hashPassword(wachtwoord, salt),
    aangemaaktOp: new Date().toISOString(),
    pushSubs: [],
  };
  data.werknemers[werknemer.id] = werknemer;
  writePortal(data);
  res.json({
    ok: true,
    werknemer: { id: werknemer.id, code, naam: werknemer.naam, email: werknemer.email },
    inlog: { code, wachtwoord, url: `${process.env.BASE_URL || ''}/werknemer.html` },
  });
});

router.post('/api/portaal/beheer/werknemers/:werknemerId/reset-wachtwoord', requireAdmin, (req, res) => {
  const data = readPortal();
  const werknemer = data.werknemers[req.params.werknemerId];
  if (!werknemer) return res.status(404).json({ error: 'Werknemer niet gevonden.' });
  const wachtwoord = newClientPassword();
  werknemer.wachtwoordSalt = crypto.randomBytes(16).toString('hex');
  werknemer.wachtwoordHash = hashPassword(wachtwoord, werknemer.wachtwoordSalt);
  writePortal(data);
  res.json({ ok: true, inlog: { code: werknemer.code, wachtwoord } });
});

router.delete('/api/portaal/beheer/werknemers/:werknemerId', requireAdmin, (req, res) => {
  const data = readPortal();
  if (!data.werknemers[req.params.werknemerId]) return res.status(404).json({ error: 'Werknemer niet gevonden.' });
  delete data.werknemers[req.params.werknemerId];
  // Urenregels bewaren we (administratie), maar zonder account kan er niets meer bij.
  writePortal(data);
  res.json({ ok: true });
});

// Urenoverzicht voor het bedrijf (periode instelbaar, incl. meerwerkuren)
router.get('/api/portaal/beheer/uren', requireAdmin, (req, res) => {
  const data = readPortal();
  const van = String(req.query.van || '0000-00-00');
  const tot = String(req.query.tot || '9999-99-99');
  const regels = Object.values(data.uren)
    .filter((u) => u.datum >= van && u.datum <= tot)
    .map((u) => ({
      ...u,
      werknemerNaam: (data.werknemers[u.werknemerId] || {}).naam || 'Oud-medewerker',
      projectNaam: u.projectId ? ((data.projects[u.projectId] || {}).naam || 'Verwijderd project') : '',
    }))
    .sort((a, b) => b.datum.localeCompare(a.datum) || a.werknemerNaam.localeCompare(b.werknemerNaam));
  res.json({ uren: regels });
});

// --- Werknemer: inloggen en urenstaat bijhouden ---
router.post('/api/portaal/werknemer/login', (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const wachtwoord = String(req.body.wachtwoord || '').trim().toUpperCase();
  if (!code || !wachtwoord) return res.status(400).json({ error: 'Vul code én wachtwoord in.' });
  const attemptKey = `werknemer:${req.ip}:${code}`;
  if (tooManyAttempts(attemptKey)) {
    return res.status(429).json({ error: 'Te veel inlogpogingen. Probeer het over een kwartier opnieuw.' });
  }
  const data = readPortal();
  const werknemer = Object.values(data.werknemers).find((w) => w.code === code);
  if (!werknemer || !verifyPassword(wachtwoord, werknemer.wachtwoordSalt, werknemer.wachtwoordHash)) {
    registerAttempt(attemptKey);
    return res.status(401).json({ error: 'Code of wachtwoord klopt niet.' });
  }
  loginAttempts.delete(attemptKey);
  setSessionCookie(res, { rol: 'werknemer', werknemerId: werknemer.id });
  res.json({ ok: true });
});

router.post('/api/portaal/werknemer/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/api/portaal/werknemer/mij', requireWerknemer, (req, res) => {
  const projecten = Object.values(req.portalData.projects)
    .filter((p) => p.status !== 'opgeleverd')
    .map((p) => ({ id: p.id, naam: p.naam }))
    .sort((a, b) => a.naam.localeCompare(b.naam));
  res.json({
    werknemer: { naam: req.werknemer.naam, code: req.werknemer.code },
    projecten,
    pushActief: (req.werknemer.pushSubs || []).length > 0,
  });
});

router.get('/api/portaal/werknemer/uren', requireWerknemer, (req, res) => {
  const van = String(req.query.van || '0000-00-00');
  const tot = String(req.query.tot || '9999-99-99');
  const regels = Object.values(req.portalData.uren)
    .filter((u) => u.werknemerId === req.werknemer.id && u.datum >= van && u.datum <= tot)
    .map((u) => ({
      ...u,
      projectNaam: u.projectId ? ((req.portalData.projects[u.projectId] || {}).naam || '') : '',
    }))
    .sort((a, b) => a.datum.localeCompare(b.datum));
  res.json({ uren: regels });
});

function valideerUrenInvoer(body) {
  const datum = String(body.datum || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return { error: 'Ongeldige datum.' };
  const uren = Number(body.uren || 0);
  const meerwerkUren = Number(body.meerwerkUren || 0);
  if (!Number.isFinite(uren) || uren < 0 || uren > 24) return { error: 'Uren moeten tussen 0 en 24 liggen.' };
  if (!Number.isFinite(meerwerkUren) || meerwerkUren < 0 || meerwerkUren > 24) return { error: 'Meerwerkuren moeten tussen 0 en 24 liggen.' };
  if (uren + meerwerkUren === 0) return { error: 'Vul minimaal uren of meerwerkuren in.' };
  return {
    datum,
    uren: Math.round(uren * 4) / 4,
    meerwerkUren: Math.round(meerwerkUren * 4) / 4,
    omschrijving: String(body.omschrijving || '').trim().slice(0, 500),
  };
}

router.post('/api/portaal/werknemer/uren', requireWerknemer, (req, res) => {
  const invoer = valideerUrenInvoer(req.body);
  if (invoer.error) return res.status(400).json({ error: invoer.error });
  const projectId = String(req.body.projectId || '').trim();
  if (projectId && !req.portalData.projects[projectId]) {
    return res.status(400).json({ error: 'Onbekend project.' });
  }
  const regel = {
    id: newId('uur'),
    werknemerId: req.werknemer.id,
    projectId: projectId || null,
    ...invoer,
    ingevuldOp: new Date().toISOString(),
  };
  req.portalData.uren[regel.id] = regel;
  writePortal(req.portalData);
  res.json({ ok: true, regel });
});

router.patch('/api/portaal/werknemer/uren/:urenId', requireWerknemer, (req, res) => {
  const regel = req.portalData.uren[req.params.urenId];
  if (!regel || regel.werknemerId !== req.werknemer.id) {
    return res.status(404).json({ error: 'Urenregel niet gevonden.' });
  }
  const invoer = valideerUrenInvoer({ ...regel, ...req.body });
  if (invoer.error) return res.status(400).json({ error: invoer.error });
  if ('projectId' in req.body) {
    const projectId = String(req.body.projectId || '').trim();
    if (projectId && !req.portalData.projects[projectId]) return res.status(400).json({ error: 'Onbekend project.' });
    regel.projectId = projectId || null;
  }
  Object.assign(regel, invoer);
  writePortal(req.portalData);
  res.json({ ok: true, regel });
});

router.delete('/api/portaal/werknemer/uren/:urenId', requireWerknemer, (req, res) => {
  const regel = req.portalData.uren[req.params.urenId];
  if (!regel || regel.werknemerId !== req.werknemer.id) {
    return res.status(404).json({ error: 'Urenregel niet gevonden.' });
  }
  delete req.portalData.uren[req.params.urenId];
  writePortal(req.portalData);
  res.json({ ok: true });
});

// ===========================================================================
// PUSHMELDINGEN  — "vergeet je uren niet" op ma t/m vr om 16:30
// Web-push met VAPID: werkt in de browser (Android direct; iPhone nadat de
// werknemer de site via "Zet op beginscherm" heeft geïnstalleerd).
// ===========================================================================
function loadVapidKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  try {
    return JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
  } catch {
    const keys = webpush.generateVAPIDKeys();
    fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2));
    return keys;
  }
}
const vapidKeys = loadVapidKeys();
webpush.setVapidDetails(
  `mailto:${process.env.MAIL_FROM_ADDRESS || process.env.SMTP_USER || 'beheer@projexa.local'}`,
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

router.get('/api/portaal/push/publieke-sleutel', (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

router.post('/api/portaal/werknemer/push', requireWerknemer, (req, res) => {
  const sub = req.body.subscription;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Geen geldig push-abonnement.' });
  req.werknemer.pushSubs = req.werknemer.pushSubs || [];
  if (!req.werknemer.pushSubs.some((s) => s.endpoint === sub.endpoint)) {
    req.werknemer.pushSubs.push(sub);
    writePortal(req.portalData);
  }
  res.json({ ok: true });
});

router.delete('/api/portaal/werknemer/push', requireWerknemer, (req, res) => {
  const endpoint = (req.body.subscription || {}).endpoint;
  req.werknemer.pushSubs = (req.werknemer.pushSubs || []).filter((s) => endpoint && s.endpoint !== endpoint);
  writePortal(req.portalData);
  res.json({ ok: true });
});

// Amsterdamse datum/tijd, onafhankelijk van de server-tijdzone.
function amsterdamNu() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(new Date());
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  return {
    datum: `${get('year')}-${get('month')}-${get('day')}`,
    minuten: Number(get('hour')) * 60 + Number(get('minute')),
    weekdag: get('weekday'), // Mon, Tue, ...
  };
}
function amsterdamDatum() {
  return amsterdamNu().datum;
}

function buildReminderTransporter() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function stuurUrenHerinneringen() {
  const data = readPortal();
  const vandaag = amsterdamDatum();
  const transporter = buildReminderTransporter();
  const payload = JSON.stringify({
    title: 'Urenstaat invullen',
    body: 'Vergeet niet je uren van vandaag in te vullen — ook eventuele meerwerkuren.',
    url: '/werknemer.html',
  });

  let dirty = false;
  for (const werknemer of Object.values(data.werknemers)) {
    const alIngevuld = Object.values(data.uren).some((u) => u.werknemerId === werknemer.id && u.datum === vandaag);
    if (alIngevuld) continue;

    // Push naar alle geregistreerde apparaten; dode abonnementen opruimen.
    const subs = werknemer.pushSubs || [];
    const nogGeldig = [];
    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub, payload);
        nogGeldig.push(sub);
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          dirty = true; // abonnement vervallen → weglaten
        } else {
          nogGeldig.push(sub);
          console.error(`[portaal] pushfout voor ${werknemer.naam}:`, err.statusCode || err.message);
        }
      }
    }
    if (nogGeldig.length !== subs.length) werknemer.pushSubs = nogGeldig;

    // E-mail als reservekanaal, als er SMTP én een e-mailadres is.
    if (transporter && werknemer.email) {
      transporter.sendMail({
        from: process.env.MAIL_FROM || 'Projexa <no-reply@aannemerscode.nl>',
        to: werknemer.email,
        subject: 'Herinnering: vul je uren van vandaag in',
        text: `Hoi ${werknemer.naam},\n\nJe uren van vandaag staan nog niet in Projexa. Vul ze even in — ook eventuele meerwerkuren:\n${process.env.BASE_URL || ''}/werknemer.html\n\nGroet,\nProjexa`,
      }).catch((err) => console.error('[portaal] herinneringsmail mislukt:', err.message));
    }
  }
  if (dirty) writePortal(data);
}

// ===========================================================================
// WACHTWOORD VERGETEN  (klant + werknemer)
// Werkt via e-mail: klopt de combinatie code + e-mailadres, dan wordt er een
// nieuw wachtwoord gegenereerd en gemaild. Het antwoord is altijd neutraal,
// zodat er niet te raden valt welke codes/e-mailadressen bestaan.
// ===========================================================================
function wachtwoordVergeten({ req, res, zoek, urlPad }) {
  const attemptKey = `vergeten:${req.ip}`;
  if (tooManyAttempts(attemptKey)) {
    return res.status(429).json({ error: 'Te veel pogingen. Probeer het over een kwartier opnieuw.' });
  }
  registerAttempt(attemptKey);

  const transporter = buildReminderTransporter();
  if (!transporter) {
    return res.status(503).json({ error: 'E-mail is op deze server nog niet ingesteld. Neem contact op met je aannemer voor een nieuw wachtwoord.' });
  }

  const code = String(req.body.code || '').trim().toUpperCase();
  const email = String(req.body.email || '').trim().toLowerCase();
  const neutraal = { ok: true, melding: 'Als de gegevens kloppen, is er zojuist een nieuw wachtwoord gemaild.' };
  if (!code || !email) return res.json(neutraal);

  const data = readPortal();
  const record = zoek(data, code, email);
  if (!record) return res.json(neutraal);

  const wachtwoord = newClientPassword();
  record.wachtwoordSalt = crypto.randomBytes(16).toString('hex');
  record.wachtwoordHash = hashPassword(wachtwoord, record.wachtwoordSalt);
  writePortal(data);

  transporter.sendMail({
    from: process.env.MAIL_FROM || 'Projexa <no-reply@aannemerscode.nl>',
    to: email,
    subject: 'Uw nieuwe Projexa-wachtwoord',
    text: `Er is een nieuw wachtwoord aangevraagd voor code ${record.code}.\n\nNieuw wachtwoord: ${wachtwoord}\n\nInloggen: ${process.env.BASE_URL || ''}${urlPad}\n\nHeeft u dit niet aangevraagd? Neem dan contact op met uw aannemer.`,
  }).catch((err) => console.error('[portaal] wachtwoord-mail mislukt:', err.message));

  res.json(neutraal);
}

router.post('/api/portaal/klant/wachtwoord-vergeten', (req, res) => {
  wachtwoordVergeten({
    req, res, urlPad: '/portaal.html',
    zoek: (data, code, email) => Object.values(data.projects).find(
      (p) => p.code === code && p.klantEmail && p.klantEmail.toLowerCase() === email
    ),
  });
});

router.post('/api/portaal/werknemer/wachtwoord-vergeten', (req, res) => {
  wachtwoordVergeten({
    req, res, urlPad: '/werknemer.html',
    zoek: (data, code, email) => Object.values(data.werknemers).find(
      (w) => w.code === code && w.email && w.email.toLowerCase() === email
    ),
  });
});

// ===========================================================================
// AI-PROJECTMANAGER — signalen
// Kijkt elke keer vers naar alle data en waarschuwt voor dingen die aandacht
// nodig hebben. De checks zijn bewust regelgebaseerd (betrouwbaar en gratis);
// de AI-schrijfhulp hieronder gebruikt Claude voor het schrijfwerk.
// ===========================================================================
router.get('/api/portaal/beheer/signalen', requireAdmin, (req, res) => {
  const data = readPortal();
  const nu = Date.now();
  const dagen = (iso) => Math.floor((nu - new Date(iso).getTime()) / 86400000);
  const signalen = [];

  for (const p of Object.values(data.projects)) {
    if (p.status === 'opgeleverd') continue;

    for (const m of p.meerwerk || []) {
      if (m.status === 'wacht_op_klant' && dagen(m.aangemaaktOp) >= 3) {
        signalen.push({ ernst: 'hoog', projectId: p.id, projectNaam: p.naam, soort: 'meerwerk',
          tekst: `Meerwerk "${m.titel}" (€ ${m.bedrag}) wacht al ${dagen(m.aangemaaktOp)} dagen op akkoord van ${p.klantNaam}.`,
          actie: 'Bel of stuur de klant even een herinnering.' });
      }
      if (m.status === 'goedgekeurd') {
        const gefactureerd = (p.documenten || []).some((d) => d.categorie === 'factuur' && d.toegevoegdOp > m.besluitOp);
        if (!gefactureerd && dagen(m.besluitOp) >= 7) {
          signalen.push({ ernst: 'middel', projectId: p.id, projectNaam: p.naam, soort: 'facturatie',
            tekst: `Goedgekeurd meerwerk "${m.titel}" (€ ${m.bedrag}) is ${dagen(m.besluitOp)} dagen geleden akkoord gegeven, maar er staat nog geen factuur in het dossier.`,
            actie: 'Maak de factuur (de AI-schrijfhulp kan een concept opstellen).' });
        }
      }
    }

    const berichten = p.berichten || [];
    const laatste = berichten[berichten.length - 1];
    if (laatste && laatste.van === 'klant' && dagen(laatste.op) >= 1) {
      signalen.push({ ernst: 'hoog', projectId: p.id, projectNaam: p.naam, soort: 'klantvraag',
        tekst: `${p.klantNaam} wacht al ${dagen(laatste.op)} dag(en) op antwoord: "${laatste.tekst.slice(0, 80)}${laatste.tekst.length > 80 ? '…' : ''}"`,
        actie: 'Beantwoord het bericht in het project.' });
    }

    if (p.status === 'in_uitvoering') {
      const fotos = (p.documenten || []).filter((d) => d.categorie === 'foto');
      const laatsteFoto = fotos[0];
      if (!laatsteFoto || dagen(laatsteFoto.toegevoegdOp) >= 5) {
        signalen.push({ ernst: 'laag', projectId: p.id, projectNaam: p.naam, soort: 'fotos',
          tekst: laatsteFoto
            ? `Al ${dagen(laatsteFoto.toegevoegdOp)} dagen geen nieuwe foto's van "${p.naam}".`
            : `Er staan nog helemaal geen foto's in het dossier van "${p.naam}".`,
          actie: 'Maak even een paar foto\'s — goed voor klant én dossier.' });
      }
      if (!(p.fases || []).some((f) => f.status === 'bezig')) {
        signalen.push({ ernst: 'middel', projectId: p.id, projectNaam: p.naam, soort: 'planning',
          tekst: `"${p.naam}" staat op "in uitvoering", maar geen enkele fase staat op "bezig".`,
          actie: 'Werk de planning bij, dan klopt het beeld voor de klant weer.' });
      }
    }

    for (const mat of p.materialen || []) {
      if (mat.status === 'bijna_op') {
        signalen.push({ ernst: 'middel', projectId: p.id, projectNaam: p.naam, soort: 'materiaal',
          tekst: `Materiaal bijna op bij "${p.naam}": ${mat.naam}${mat.aantal ? ` (${mat.aantal})` : ''}.`,
          actie: 'Bestel bij of zet op "besteld".' });
      }
    }
  }

  // Uren: welke werknemer heeft de vorige werkdag niets ingevuld?
  const gisterenWerkdag = (() => {
    const d = new Date();
    do { d.setDate(d.getDate() - 1); } while ([0, 6].includes(d.getDay()));
    return d.toISOString().slice(0, 10);
  })();
  for (const w of Object.values(data.werknemers)) {
    const heeft = Object.values(data.uren).some((u) => u.werknemerId === w.id && u.datum === gisterenWerkdag);
    if (!heeft && dagen(w.aangemaaktOp) >= 2) {
      signalen.push({ ernst: 'middel', soort: 'uren',
        tekst: `${w.naam} heeft de uren van de vorige werkdag (${gisterenWerkdag}) nog niet ingevuld.`,
        actie: 'De automatische herinnering gaat om 16:30 — of stuur zelf even een berichtje.' });
    }
  }

  // Taken over deadline
  for (const t of Object.values(data.taken || {})) {
    if (!t.klaar && t.deadline && t.deadline < amsterdamDatum()) {
      signalen.push({ ernst: 'middel', soort: 'taak',
        tekst: `Taak over de deadline (${t.deadline}): ${t.tekst}`,
        actie: 'Afronden of de deadline bijwerken.' });
    }
  }

  const volgorde = { hoog: 0, middel: 1, laag: 2 };
  signalen.sort((a, b) => volgorde[a.ernst] - volgorde[b.ernst]);
  res.json({ signalen });
});

// ===========================================================================
// AI-SCHRIJFHULP — Claude schrijft concepten op basis van de projectdata
// (dagrapport, klantupdate, werkbon, conceptfactuur, opleverrapport, logboek).
// De invoer kan getypt óf ingesproken zijn (dicteren gebeurt in de browser).
// ===========================================================================
function projectContext(data, p) {
  const vandaag = amsterdamDatum();
  const urenVandaag = Object.values(data.uren)
    .filter((u) => u.projectId === p.id && u.datum >= vandaag)
    .map((u) => `${(data.werknemers[u.werknemerId] || {}).naam || 'medewerker'}: ${u.uren} uur${u.meerwerkUren ? ` + ${u.meerwerkUren} meerwerkuur` : ''}${u.omschrijving ? ` (${u.omschrijving})` : ''}`);
  return [
    `Project: ${p.naam} — klant: ${p.klantNaam}${p.adres ? `, ${p.adres}` : ''}. Status: ${p.status}.`,
    p.omschrijving ? `Omschrijving: ${p.omschrijving}` : '',
    (p.fases || []).length ? `Fases: ${p.fases.map((f) => `${f.naam} [${f.status}]`).join('; ')}` : '',
    (p.meerwerk || []).length ? `Meerwerk: ${p.meerwerk.map((m) => `${m.titel} € ${m.bedrag} [${m.status}]`).join('; ')}` : '',
    (p.updates || []).slice(0, 3).length ? `Laatste updates: ${p.updates.slice(0, 3).map((u) => u.tekst).join(' | ')}` : '',
    (p.documenten || []).filter((d) => d.aiSamenvatting).slice(0, 5).length
      ? `Recente foto's (AI-beschrijving): ${p.documenten.filter((d) => d.aiSamenvatting).slice(0, 5).map((d) => d.aiSamenvatting).join(' | ')}` : '',
    urenVandaag.length ? `Uren van vandaag: ${urenVandaag.join('; ')}` : '',
  ].filter(Boolean).join('\n');
}

const SCHRIJF_TYPES = {
  dagrapport: 'Schrijf een kort dagrapport (voor het projectdossier): wat is er vandaag gedaan, door wie, bijzonderheden. Zakelijk, puntsgewijs waar dat helpt.',
  klantupdate: 'Schrijf een vriendelijke, korte voortgangsupdate aan de klant (u-vorm): wat is er gedaan, wat is de volgende stap. Geen jargon.',
  werkbon: 'Schrijf een werkbon: datum, uitgevoerde werkzaamheden, gebruikte materialen (indien bekend), uren. Strak en zakelijk, geschikt om te printen.',
  conceptfactuur: 'Stel een CONCEPT-factuurspecificatie op: regels met omschrijving en bedrag op basis van goedgekeurd meerwerk en gemaakte uren (als bedragen onbekend zijn: "p.m."). Sluit af met de zin dat dit een concept is dat het bedrijf nog controleert.',
  opleverrapport: 'Schrijf een oplevertekst voor in het opleverdossier: wat is er opgeleverd, in welke staat, eventuele afspraken. Warm maar zakelijk, u-vorm.',
  logboek: 'Schrijf een korte logboeknotitie voor het projectdossier op basis van de invoer. Feitelijk, met datum-context.',
};

router.post('/api/portaal/beheer/projecten/:projectId/ai/schrijf', requireAdmin, async (req, res) => {
  const found = findProject(req, res);
  if (!found) return;
  const type = String(req.body.type || '');
  if (!SCHRIJF_TYPES[type]) return res.status(400).json({ error: 'Onbekend teksttype.' });
  const invoer = String(req.body.invoer || '').trim().slice(0, 4000);
  try {
    const tekst = await aiTekst({
      system: 'Je bent de administratieve rechterhand van een Nederlands aannemersbedrijf. Je schrijft in het Nederlands. Wees concreet en beknopt; verzin geen feiten die niet in de context staan.',
      prompt: `${SCHRIJF_TYPES[type]}\n\nProjectcontext:\n${projectContext(found.data, found.project)}\n\n${invoer ? `Aantekeningen van de aannemer (getypt of ingesproken):\n${invoer}` : 'Er zijn geen extra aantekeningen; baseer je op de projectcontext.'}\n\nDatum vandaag: ${amsterdamDatum()}.`,
    });
    res.json({ ok: true, tekst });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// Werknemer spreekt/typt kort in wat er gedaan is → AI maakt er een net
// dagrapport van dat als update in het projectdossier komt.
router.post('/api/portaal/werknemer/dagrapport', requireWerknemer, async (req, res) => {
  const projectId = String(req.body.projectId || '');
  const project = req.portalData.projects[projectId];
  if (!project) return res.status(400).json({ error: 'Kies een project.' });
  const invoer = String(req.body.invoer || '').trim().slice(0, 4000);
  if (!invoer) return res.status(400).json({ error: 'Vertel eerst kort wat je gedaan hebt.' });
  try {
    const tekst = await aiTekst({
      system: 'Je zet ruwe (vaak ingesproken) aantekeningen van een bouwvakker om in een net, kort dagrapport in het Nederlands. Feitelijk, geen verzinsels.',
      prompt: `Aantekeningen van ${req.werknemer.naam} over project "${project.naam}" (${amsterdamDatum()}):\n${invoer}\n\nMaak hier een dagrapport van (3-6 zinnen of punten).`,
      maxTokens: 1024,
    });
    project.updates = project.updates || [];
    const update = { id: newId('upd'), tekst: `Dagrapport ${req.werknemer.naam}:\n${tekst}`, op: new Date().toISOString() };
    project.updates.unshift(update);
    writePortal(req.portalData);
    res.json({ ok: true, tekst, update });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// ===========================================================================
// ADMINISTRATIE — materialen, taken, klanten, werkbonnen, urenexport
// ===========================================================================

// --- Materialen per project (voedt ook het signaal "materiaal bijna op") ---
router.post('/api/portaal/beheer/projecten/:projectId/materialen', requireAdmin, (req, res) => {
  const found = findProject(req, res);
  if (!found) return;
  const naam = String(req.body.naam || '').trim();
  if (!naam) return res.status(400).json({ error: 'Naam van het materiaal is verplicht.' });
  const mat = {
    id: newId('mat'), naam,
    aantal: String(req.body.aantal || '').trim(),
    status: ['op_voorraad', 'bijna_op', 'besteld'].includes(req.body.status) ? req.body.status : 'op_voorraad',
    notitie: String(req.body.notitie || '').trim(),
  };
  found.project.materialen = found.project.materialen || [];
  found.project.materialen.push(mat);
  writePortal(found.data);
  res.json({ ok: true, materiaal: mat });
});

router.patch('/api/portaal/beheer/projecten/:projectId/materialen/:matId', requireAdmin, (req, res) => {
  const found = findProject(req, res);
  if (!found) return;
  const mat = (found.project.materialen || []).find((m) => m.id === req.params.matId);
  if (!mat) return res.status(404).json({ error: 'Materiaal niet gevonden.' });
  for (const v of ['naam', 'aantal', 'notitie']) if (v in req.body) mat[v] = String(req.body[v] || '').trim();
  if ('status' in req.body && ['op_voorraad', 'bijna_op', 'besteld'].includes(req.body.status)) mat.status = req.body.status;
  writePortal(found.data);
  res.json({ ok: true, materiaal: mat });
});

router.delete('/api/portaal/beheer/projecten/:projectId/materialen/:matId', requireAdmin, (req, res) => {
  const found = findProject(req, res);
  if (!found) return;
  found.project.materialen = (found.project.materialen || []).filter((m) => m.id !== req.params.matId);
  writePortal(found.data);
  res.json({ ok: true });
});

// --- Werkbonnen per project (handmatig of via de AI-schrijfhulp) ---
router.post('/api/portaal/beheer/projecten/:projectId/werkbonnen', requireAdmin, (req, res) => {
  const found = findProject(req, res);
  if (!found) return;
  const tekst = String(req.body.tekst || '').trim();
  if (!tekst) return res.status(400).json({ error: 'Werkbon is leeg.' });
  const bon = { id: newId('bon'), titel: String(req.body.titel || `Werkbon ${amsterdamDatum()}`).trim(), tekst, op: new Date().toISOString() };
  found.project.werkbonnen = found.project.werkbonnen || [];
  found.project.werkbonnen.unshift(bon);
  writePortal(found.data);
  res.json({ ok: true, werkbon: bon });
});

router.delete('/api/portaal/beheer/projecten/:projectId/werkbonnen/:bonId', requireAdmin, (req, res) => {
  const found = findProject(req, res);
  if (!found) return;
  found.project.werkbonnen = (found.project.werkbonnen || []).filter((b) => b.id !== req.params.bonId);
  writePortal(found.data);
  res.json({ ok: true });
});

// --- Taken (algemeen of per project) ---
router.get('/api/portaal/beheer/taken', requireAdmin, (req, res) => {
  const data = readPortal();
  const taken = Object.values(data.taken || {})
    .map((t) => ({ ...t, projectNaam: t.projectId ? ((data.projects[t.projectId] || {}).naam || '') : '' }))
    .sort((a, b) => (a.klaar === b.klaar ? (a.deadline || '9999').localeCompare(b.deadline || '9999') : a.klaar ? 1 : -1));
  res.json({ taken });
});

router.post('/api/portaal/beheer/taken', requireAdmin, (req, res) => {
  const tekst = String(req.body.tekst || '').trim();
  if (!tekst) return res.status(400).json({ error: 'Taak is leeg.' });
  const data = readPortal();
  data.taken = data.taken || {};
  const taak = {
    id: newId('taak'), tekst,
    projectId: String(req.body.projectId || '') || null,
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(req.body.deadline || '') ? req.body.deadline : '',
    klaar: false, aangemaaktOp: new Date().toISOString(),
  };
  data.taken[taak.id] = taak;
  writePortal(data);
  res.json({ ok: true, taak });
});

router.patch('/api/portaal/beheer/taken/:taakId', requireAdmin, (req, res) => {
  const data = readPortal();
  const taak = (data.taken || {})[req.params.taakId];
  if (!taak) return res.status(404).json({ error: 'Taak niet gevonden.' });
  if ('klaar' in req.body) taak.klaar = Boolean(req.body.klaar);
  if ('tekst' in req.body) taak.tekst = String(req.body.tekst || '').trim();
  if ('deadline' in req.body) taak.deadline = /^\d{4}-\d{2}-\d{2}$/.test(req.body.deadline || '') ? req.body.deadline : '';
  writePortal(data);
  res.json({ ok: true, taak });
});

router.delete('/api/portaal/beheer/taken/:taakId', requireAdmin, (req, res) => {
  const data = readPortal();
  if (!(data.taken || {})[req.params.taakId]) return res.status(404).json({ error: 'Taak niet gevonden.' });
  delete data.taken[req.params.taakId];
  writePortal(data);
  res.json({ ok: true });
});

// --- Klantenbestand (afgeleid uit de projecten) ---
router.get('/api/portaal/beheer/klanten', requireAdmin, (req, res) => {
  const data = readPortal();
  const perKlant = new Map();
  for (const p of Object.values(data.projects)) {
    const sleutel = `${p.klantNaam}|${(p.klantEmail || '').toLowerCase()}`;
    if (!perKlant.has(sleutel)) {
      perKlant.set(sleutel, { naam: p.klantNaam, email: p.klantEmail || '', telefoon: p.klantTelefoon || '', projecten: [] });
    }
    const klant = perKlant.get(sleutel);
    if (!klant.telefoon && p.klantTelefoon) klant.telefoon = p.klantTelefoon;
    klant.projecten.push({ id: p.id, naam: p.naam, status: p.status, adres: p.adres });
  }
  res.json({ klanten: [...perKlant.values()].sort((a, b) => a.naam.localeCompare(b.naam)) });
});

// --- Urenexport (CSV) voor de boekhouding — te openen in Excel of te
//     importeren in Exact/Moneybird/AFAS. Meerwerk-export idem. ---
function csvVeld(s) { return `"${String(s == null ? '' : s).replace(/"/g, '""')}"`; }

router.get('/api/portaal/beheer/export/uren.csv', requireAdmin, (req, res) => {
  const data = readPortal();
  const van = String(req.query.van || '0000-00-00');
  const tot = String(req.query.tot || '9999-99-99');
  const regels = Object.values(data.uren)
    .filter((u) => u.datum >= van && u.datum <= tot)
    .sort((a, b) => a.datum.localeCompare(b.datum));
  const csv = ['datum;werknemer;project;uren;meerwerkuren;omschrijving']
    .concat(regels.map((u) => [
      u.datum,
      (data.werknemers[u.werknemerId] || {}).naam || 'oud-medewerker',
      u.projectId ? ((data.projects[u.projectId] || {}).naam || '') : 'algemeen',
      String(u.uren).replace('.', ','),
      String(u.meerwerkUren).replace('.', ','),
      u.omschrijving || '',
    ].map(csvVeld).join(';')))
    .join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="projexa-uren-${van}-tm-${tot}.csv"`);
  res.send('﻿' + csv);
});

router.get('/api/portaal/beheer/export/meerwerk.csv', requireAdmin, (req, res) => {
  const data = readPortal();
  const rijen = [];
  for (const p of Object.values(data.projects)) {
    for (const m of p.meerwerk || []) {
      rijen.push([p.naam, p.klantNaam, m.titel, String(m.bedrag).replace('.', ','), m.status, (m.besluitOp || '').slice(0, 10)]);
    }
  }
  const csv = ['project;klant;omschrijving;bedrag;status;besluitdatum']
    .concat(rijen.map((r) => r.map(csvVeld).join(';'))).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="projexa-meerwerk.csv"');
  res.send('﻿' + csv);
});

// Elke minuut kijken of het ma-vr tussen 16:30 en 16:40 Amsterdamse tijd is;
// per dag maximaal één herinneringsronde (bijgehouden in data/portal.json).
const WERKDAGEN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
function checkHerinnering() {
  const nu = amsterdamNu();
  if (!WERKDAGEN.includes(nu.weekdag)) return;
  if (nu.minuten < 16 * 60 + 30 || nu.minuten >= 16 * 60 + 40) return;
  const data = readPortal();
  if (data.meta.laatsteHerinnering === nu.datum) return;
  data.meta.laatsteHerinnering = nu.datum;
  writePortal(data);
  stuurUrenHerinneringen().catch((err) => console.error('[portaal] herinneringsronde mislukt:', err));
}
setInterval(checkHerinnering, 60 * 1000);

module.exports = router;
