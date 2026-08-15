'use strict';

/**
 * Projexa — database
 *
 * SQLite in één bestand. Dat is genoeg tot ver in de honderden projecten en
 * scheelt een externe dienst. Let op: op Render heeft dit bestand een vaste
 * schijf nodig (Disk toevoegen en PROJEXA_DB naar dat pad laten wijzen),
 * anders is de database weg bij elke herstart.
 *
 * Willen we later naar Postgres, dan is dit het enige bestand dat op de schop
 * gaat: de rest van de app praat alleen via de functies hieronder.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PAD = process.env.PROJEXA_DB || path.join(__dirname, '..', 'data', 'projexa.db');

fs.mkdirSync(path.dirname(DB_PAD), { recursive: true });

const db = new Database(DB_PAD);

// WAL laat lezen en schrijven tegelijk toe; foreign_keys moet per verbinding aan.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS eigenaren (
    id             TEXT PRIMARY KEY,
    naam           TEXT NOT NULL,
    email          TEXT NOT NULL UNIQUE,
    wachtwoord     TEXT NOT NULL,
    aangemaakt_op  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projecten (
    id             TEXT PRIMARY KEY,
    eigenaar_id    TEXT NOT NULL REFERENCES eigenaren(id) ON DELETE CASCADE,
    naam           TEXT NOT NULL,
    adres          TEXT NOT NULL DEFAULT '',
    aanneemsom     INTEGER,
    start          TEXT NOT NULL DEFAULT '',
    oplevering     TEXT NOT NULL DEFAULT '',
    voortgang      INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'lopend',
    afgesloten_op  TEXT,
    aangemaakt_op  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_projecten_eigenaar ON projecten(eigenaar_id);

  -- Een deelnemer is een uitgenodigd bedrijf. Zijn inlog hoort bij één project:
  -- dezelfde aannemer op twee projecten krijgt twee codes.
  CREATE TABLE IF NOT EXISTS deelnemers (
    id                TEXT PRIMARY KEY,
    project_id        TEXT NOT NULL REFERENCES projecten(id) ON DELETE CASCADE,
    bedrijfsnaam      TEXT NOT NULL,
    rol               TEXT NOT NULL DEFAULT '',
    contactpersoon    TEXT NOT NULL DEFAULT '',
    email             TEXT NOT NULL DEFAULT '',
    code              TEXT NOT NULL UNIQUE,
    wachtwoord        TEXT NOT NULL,
    uitgenodigd_op    TEXT NOT NULL,
    laatst_ingelogd   TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_deelnemers_project ON deelnemers(project_id);

  CREATE TABLE IF NOT EXISTS sessies (
    token          TEXT PRIMARY KEY,
    soort          TEXT NOT NULL,
    persoon_id     TEXT NOT NULL,
    aangemaakt_op  TEXT NOT NULL,
    verloopt_op    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessies_verloop ON sessies(verloopt_op);

  CREATE TABLE IF NOT EXISTS berichten (
    id            TEXT PRIMARY KEY,
    project_id    TEXT NOT NULL REFERENCES projecten(id) ON DELETE CASCADE,
    deelnemer_id  TEXT NOT NULL REFERENCES deelnemers(id) ON DELETE CASCADE,
    van           TEXT NOT NULL,
    tekst         TEXT NOT NULL,
    op            TEXT NOT NULL,
    gelezen_door_eigenaar   INTEGER NOT NULL DEFAULT 0,
    gelezen_door_deelnemer  INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_berichten_gesprek ON berichten(deelnemer_id, op);
`);

/** Ruimt verlopen sessies op. Draait bij het starten en daarna elk uur. */
function ruimSessiesOp() {
  db.prepare('DELETE FROM sessies WHERE verloopt_op < ?').run(new Date().toISOString());
}
ruimSessiesOp();
setInterval(ruimSessiesOp, 60 * 60 * 1000).unref();

module.exports = { db, DB_PAD };
