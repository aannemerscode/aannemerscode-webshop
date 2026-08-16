'use strict';

/**
 * Projexa — bouwdagboek, foto's, meerwerk en akkoorden
 *
 * Deze routes hangen aan dezelfde router als de rest van de API; ze staan
 * apart omdat het inhoudelijk het hart van het product is: wat er is gebeurd,
 * wat het extra kost, en waar de klant ja tegen heeft gezegd.
 */

const { db } = require('./db');
const A = require('./auth');
const opslag = require('./opslag');

const nu = () => new Date().toISOString();
const tekst = (waarde, max) => String(waarde == null ? '' : waarde).trim().slice(0, max);

/* -------------------------------------------------------------------------
   Toegang
   ------------------------------------------------------------------------- */

/**
 * Bepaalt bij welk project dit verzoek hoort en wie je bent. De eigenaar geeft
 * het project mee in de URL; een deelnemer heeft er maar één, dus die halen we
 * uit zijn sessie en negeren we wat er in de URL staat.
 */
function context(req, projectId) {
  const sessie = A.huidigeSessie(req);
  if (!sessie) return { fout: 401, melding: 'Log eerst in.' };

  if (sessie.soort === 'eigenaar') {
    const project = A.projectVanEigenaar(projectId, sessie.eigenaar.id);
    if (!project) return { fout: 404, melding: 'Project niet gevonden.' };
    return { rol: 'eigenaar', project, naam: sessie.eigenaar.naam, deelnemer: null };
  }

  const deelnemer = sessie.deelnemer;
  const project = db.prepare('SELECT * FROM projecten WHERE id = ?').get(deelnemer.project_id);
  if (!project) return { fout: 404, melding: 'Project niet gevonden.' };
  return { rol: 'deelnemer', project, naam: deelnemer.bedrijfsnaam, deelnemer };
}

function magSchrijven(ctx) {
  if (ctx.project.status === 'afgesloten') {
    return 'Dit project is afgesloten. Je kunt alles teruglezen, maar niets meer toevoegen.';
  }
  return null;
}

/* -------------------------------------------------------------------------
   Foto's
   ------------------------------------------------------------------------- */

function fotosBij(soort, koppelingId) {
  return db
    .prepare('SELECT id, bestandsnaam, door, op FROM fotos WHERE soort = ? AND koppeling_id = ? ORDER BY op')
    .all(soort, koppelingId);
}

/** Slaat de geüploade bestanden op en koppelt ze aan een dagboekregel of meerwerk. */
async function bewaarFotos(bestanden, ctx, soort, koppelingId) {
  const bewaard = [];

  for (const bestand of bestanden || []) {
    if (!bestand.mimetype || bestand.mimetype.indexOf('image/') !== 0) continue;

    const sleutel = opslag.nieuweSleutel(ctx.project.id, bestand.originalname);
    await opslag.bewaar(sleutel, bestand.buffer, bestand.mimetype);

    const id = A.nieuwId('fot');
    db.prepare(
      `INSERT INTO fotos (id, project_id, soort, koppeling_id, sleutel, bestandsnaam, type, grootte, door, op)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, ctx.project.id, soort, koppelingId, sleutel,
      tekst(bestand.originalname, 200), bestand.mimetype, bestand.size, ctx.naam, nu()
    );

    bewaard.push(id);
  }

  return bewaard;
}

/* -------------------------------------------------------------------------
   Naar buiten
   ------------------------------------------------------------------------- */

function dagboekNaarBuiten(rij) {
  let punten = [];
  try { punten = JSON.parse(rij.punten) || []; } catch { punten = []; }

  return {
    id: rij.id,
    auteur: rij.auteur,
    auteurNaam: rij.auteur_naam,
    datum: rij.datum,
    titel: rij.titel,
    punten,
    uren: rij.uren,
    op: rij.op,
    fotos: fotosBij('dagboek', rij.id),
  };
}

function meerwerkNaarBuiten(rij) {
  return {
    id: rij.id,
    nummer: rij.nummer,
    titel: rij.titel,
    omschrijving: rij.omschrijving,
    bedrag: rij.bedrag_cent / 100,
    status: rij.status,
    voorsteller: rij.voorsteller,
    voorgesteldOp: rij.voorgesteld_op,
    besluitOp: rij.besluit_op,
    fotos: fotosBij('meerwerk', rij.id),
  };
}

function akkoordNaarBuiten(rij) {
  return {
    id: rij.id,
    soort: rij.soort,
    titel: rij.titel,
    omschrijving: rij.omschrijving,
    bedrag: rij.bedrag_cent == null ? null : rij.bedrag_cent / 100,
    door: rij.door,
    vastgelegdOp: rij.vastgelegd_op,
  };
}

/** Bedrag uit een invoerveld naar hele centen. "1.250,50" en "1250.5" mogen allebei. */
function naarCenten(invoer) {
  const ruw = String(invoer == null ? '' : invoer).trim().replace(/[€\s]/g, '');
  if (!ruw) return null;

  // Laatste scheidingsteken is de komma of punt vóór de centen.
  const genormaliseerd = ruw.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const getal = Number(genormaliseerd);
  if (!isFinite(getal) || getal < 0) return null;

  return Math.round(getal * 100);
}

/* =========================================================================
   Routes
   ========================================================================= */

module.exports = function koppel(router, upload) {
  /* ---------------------------------------------------------------------
     Bouwdagboek
     --------------------------------------------------------------------- */

  router.get('/projecten/:projectId/dagboek', (req, res) => {
    const ctx = context(req, req.params.projectId);
    if (ctx.fout) return res.status(ctx.fout).json({ fout: ctx.melding });

    const rijen = db
      .prepare('SELECT * FROM dagboek WHERE project_id = ? ORDER BY datum DESC, op DESC')
      .all(ctx.project.id);

    res.json({ dagboek: rijen.map(dagboekNaarBuiten), fotoopslag: opslag.beschikbaar() });
  });

  router.post('/projecten/:projectId/dagboek', upload.array('fotos', 8), async (req, res) => {
    const ctx = context(req, req.params.projectId);
    if (ctx.fout) return res.status(ctx.fout).json({ fout: ctx.melding });

    const dicht = magSchrijven(ctx);
    if (dicht) return res.status(409).json({ fout: dicht });

    const titel = tekst(req.body.titel, 200);
    if (!titel) return res.status(400).json({ fout: 'Beschrijf kort wat er is gedaan.' });

    if ((req.files || []).length && !opslag.beschikbaar()) {
      return res.status(503).json({ fout: opslag.watIsErMis() });
    }

    const punten = String(req.body.punten || '')
      .split('\n').map((r) => r.trim()).filter(Boolean).slice(0, 20)
      .map((r) => r.slice(0, 200));

    const id = A.nieuwId('dag');
    const datum = /^\d{4}-\d{2}-\d{2}$/.test(req.body.datum || '')
      ? req.body.datum
      : new Date().toISOString().slice(0, 10);

    db.prepare(
      `INSERT INTO dagboek (id, project_id, auteur, deelnemer_id, auteur_naam, datum, titel, punten, uren, op)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, ctx.project.id, ctx.rol, ctx.deelnemer ? ctx.deelnemer.id : null,
      ctx.naam, datum, titel, JSON.stringify(punten), tekst(req.body.uren, 40), nu()
    );

    try {
      await bewaarFotos(req.files, ctx, 'dagboek', id);
    } catch (err) {
      console.error('Foto opslaan mislukt:', err);
      // De dagregel zelf staat er al; alleen de foto's misten.
      return res.status(502).json({
        fout: 'De dagregel is opgeslagen, maar de foto\'s niet. Probeer ze opnieuw toe te voegen.',
      });
    }

    const rij = db.prepare('SELECT * FROM dagboek WHERE id = ?').get(id);
    res.json({ ok: true, dag: dagboekNaarBuiten(rij) });
  });

  /** Foto uitleveren: bij S3 met een korte ondertekende link, lokaal rechtstreeks. */
  router.get('/fotos/:id', async (req, res) => {
    const foto = db.prepare('SELECT * FROM fotos WHERE id = ?').get(req.params.id);
    if (!foto) return res.status(404).json({ fout: 'Foto niet gevonden.' });

    const ctx = context(req, foto.project_id);
    if (ctx.fout) return res.status(ctx.fout).json({ fout: ctx.melding });

    try {
      const adres = await opslag.leesAdres(foto.sleutel);
      if (adres) return res.redirect(adres);

      const pad = opslag.lokaalBestand(foto.sleutel);
      if (!pad) return res.status(404).json({ fout: 'Foto niet gevonden.' });

      res.type(foto.type || 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.sendFile(pad);
    } catch (err) {
      console.error('Foto ophalen mislukt:', err);
      return res.status(502).json({ fout: 'Kon de foto niet ophalen.' });
    }
  });

  /* ---------------------------------------------------------------------
     Meerwerk
     --------------------------------------------------------------------- */

  router.get('/projecten/:projectId/meerwerk', (req, res) => {
    const ctx = context(req, req.params.projectId);
    if (ctx.fout) return res.status(ctx.fout).json({ fout: ctx.melding });

    const rijen = db
      .prepare('SELECT * FROM meerwerk WHERE project_id = ? ORDER BY nummer DESC')
      .all(ctx.project.id);

    const goedgekeurd = rijen
      .filter((r) => r.status === 'akkoord')
      .reduce((totaal, r) => totaal + r.bedrag_cent, 0);

    res.json({
      meerwerk: rijen.map(meerwerkNaarBuiten),
      goedgekeurd: goedgekeurd / 100,
      fotoopslag: opslag.beschikbaar(),
    });
  });

  router.post('/projecten/:projectId/meerwerk', upload.array('fotos', 8), async (req, res) => {
    const ctx = context(req, req.params.projectId);
    if (ctx.fout) return res.status(ctx.fout).json({ fout: ctx.melding });

    const dicht = magSchrijven(ctx);
    if (dicht) return res.status(409).json({ fout: dicht });

    const titel = tekst(req.body.titel, 200);
    if (!titel) return res.status(400).json({ fout: 'Geef het meerwerk een korte omschrijving.' });

    const centen = naarCenten(req.body.bedrag);
    if (centen == null) return res.status(400).json({ fout: 'Vul een geldig bedrag in.' });

    if ((req.files || []).length && !opslag.beschikbaar()) {
      return res.status(503).json({ fout: opslag.watIsErMis() });
    }

    const hoogste = db
      .prepare('SELECT MAX(nummer) AS n FROM meerwerk WHERE project_id = ?')
      .get(ctx.project.id).n || 0;

    const id = A.nieuwId('mwk');
    db.prepare(
      `INSERT INTO meerwerk
         (id, project_id, nummer, titel, omschrijving, bedrag_cent, status, deelnemer_id, voorsteller, voorgesteld_op, gelezen_door_eigenaar)
       VALUES (?, ?, ?, ?, ?, ?, 'wacht', ?, ?, ?, ?)`
    ).run(
      id, ctx.project.id, hoogste + 1, titel, tekst(req.body.omschrijving, 2000), centen,
      ctx.deelnemer ? ctx.deelnemer.id : null, ctx.naam, nu(), ctx.rol === 'eigenaar' ? 1 : 0
    );

    try {
      await bewaarFotos(req.files, ctx, 'meerwerk', id);
    } catch (err) {
      console.error('Foto opslaan mislukt:', err);
      return res.status(502).json({
        fout: 'Het voorstel is opgeslagen, maar de foto\'s niet. Probeer ze opnieuw toe te voegen.',
      });
    }

    // Een regel in de chat, zodat het voorstel niet ongemerkt langskomt.
    if (ctx.deelnemer) {
      db.prepare(
        `INSERT INTO berichten (id, project_id, deelnemer_id, van, tekst, op, gelezen_door_eigenaar, gelezen_door_deelnemer)
         VALUES (?, ?, ?, 'deelnemer', ?, ?, 0, 1)`
      ).run(
        A.nieuwId('ber'), ctx.project.id, ctx.deelnemer.id,
        `Meerwerk #${hoogste + 1} voorgesteld: ${titel} — € ${(centen / 100).toLocaleString('nl-NL')}`,
        nu()
      );
    }

    const rij = db.prepare('SELECT * FROM meerwerk WHERE id = ?').get(id);
    res.json({ ok: true, meerwerk: meerwerkNaarBuiten(rij) });
  });

  /** Alleen de eigenaar beslist — dat is de kern van het hele product. */
  router.post('/meerwerk/:id/besluit', A.alleenEigenaar, (req, res) => {
    const rij = db.prepare('SELECT * FROM meerwerk WHERE id = ?').get(req.params.id);
    if (!rij) return res.status(404).json({ fout: 'Meerwerk niet gevonden.' });

    const project = A.projectVanEigenaar(rij.project_id, req.eigenaar.id);
    if (!project) return res.status(404).json({ fout: 'Meerwerk niet gevonden.' });

    if (project.status === 'afgesloten') {
      return res.status(409).json({ fout: 'Dit project is afgesloten.' });
    }
    if (rij.status !== 'wacht') {
      return res.status(409).json({ fout: 'Hier is al een besluit over genomen.' });
    }

    const besluit = req.body.besluit === 'akkoord' ? 'akkoord' : 'afgewezen';
    const stempel = nu();

    // Besluit en vastlegging horen bij elkaar: allebei, of geen van beide.
    db.transaction(() => {
      db.prepare('UPDATE meerwerk SET status = ?, besluit_op = ?, gelezen_door_eigenaar = 1 WHERE id = ?')
        .run(besluit, stempel, rij.id);

      db.prepare(
        `INSERT INTO akkoorden (id, project_id, soort, titel, omschrijving, bedrag_cent, meerwerk_id, door, vastgelegd_op)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        A.nieuwId('akk'), rij.project_id, besluit,
        `Meerwerk #${rij.nummer} — ${rij.titel}${besluit === 'afgewezen' ? ' afgewezen' : ''}`,
        rij.omschrijving, rij.bedrag_cent, rij.id, req.eigenaar.naam, stempel
      );

      if (rij.deelnemer_id) {
        db.prepare(
          `INSERT INTO berichten (id, project_id, deelnemer_id, van, tekst, op, gelezen_door_eigenaar, gelezen_door_deelnemer)
           VALUES (?, ?, ?, 'eigenaar', ?, ?, 1, 0)`
        ).run(
          A.nieuwId('ber'), rij.project_id, rij.deelnemer_id,
          `Meerwerk #${rij.nummer} ${besluit === 'akkoord' ? 'goedgekeurd' : 'afgewezen'} door ${req.eigenaar.naam}`,
          stempel
        );
      }
    })();

    const bijgewerkt = db.prepare('SELECT * FROM meerwerk WHERE id = ?').get(rij.id);
    res.json({ ok: true, meerwerk: meerwerkNaarBuiten(bijgewerkt) });
  });

  /* ---------------------------------------------------------------------
     Akkoorden
     --------------------------------------------------------------------- */

  router.get('/projecten/:projectId/akkoorden', (req, res) => {
    const ctx = context(req, req.params.projectId);
    if (ctx.fout) return res.status(ctx.fout).json({ fout: ctx.melding });

    const rijen = db
      .prepare('SELECT * FROM akkoorden WHERE project_id = ? ORDER BY vastgelegd_op DESC')
      .all(ctx.project.id);

    res.json({ akkoorden: rijen.map(akkoordNaarBuiten) });
  });

  /** Losse vastlegging zonder bedrag: een keuze of afspraak die je wilt bewaren. */
  router.post('/projecten/:projectId/akkoorden', A.alleenEigenaar, (req, res) => {
    const project = A.projectVanEigenaar(req.params.projectId, req.eigenaar.id);
    if (!project) return res.status(404).json({ fout: 'Project niet gevonden.' });
    if (project.status === 'afgesloten') {
      return res.status(409).json({ fout: 'Dit project is afgesloten.' });
    }

    const titel = tekst(req.body.titel, 200);
    if (!titel) return res.status(400).json({ fout: 'Waar gaat deze afspraak over?' });

    const id = A.nieuwId('akk');
    db.prepare(
      `INSERT INTO akkoorden (id, project_id, soort, titel, omschrijving, bedrag_cent, meerwerk_id, door, vastgelegd_op)
       VALUES (?, ?, 'afspraak', ?, ?, NULL, NULL, ?, ?)`
    ).run(id, project.id, titel, tekst(req.body.omschrijving, 2000), req.eigenaar.naam, nu());

    const rij = db.prepare('SELECT * FROM akkoorden WHERE id = ?').get(id);
    res.json({ ok: true, akkoord: akkoordNaarBuiten(rij) });
  });

  /* ---------------------------------------------------------------------
     Samenvatting voor het startscherm
     --------------------------------------------------------------------- */

  router.get('/projecten/:projectId/samenvatting', (req, res) => {
    const ctx = context(req, req.params.projectId);
    if (ctx.fout) return res.status(ctx.fout).json({ fout: ctx.melding });

    const id = ctx.project.id;
    const eenGetal = (sql, ...args) => db.prepare(sql).get(id, ...args).n;

    const openMeerwerk = db
      .prepare("SELECT * FROM meerwerk WHERE project_id = ? AND status = 'wacht' ORDER BY nummer DESC")
      .all(id);

    const goedgekeurd = db
      .prepare("SELECT COALESCE(SUM(bedrag_cent), 0) AS n FROM meerwerk WHERE project_id = ? AND status = 'akkoord'")
      .get(id).n;

    res.json({
      dagen: eenGetal('SELECT COUNT(*) AS n FROM dagboek WHERE project_id = ?'),
      fotos: eenGetal('SELECT COUNT(*) AS n FROM fotos WHERE project_id = ?'),
      akkoorden: eenGetal('SELECT COUNT(*) AS n FROM akkoorden WHERE project_id = ?'),
      openMeerwerk: openMeerwerk.map(meerwerkNaarBuiten),
      goedgekeurdMeerwerk: goedgekeurd / 100,
      laatsteDag: (() => {
        const rij = db
          .prepare('SELECT * FROM dagboek WHERE project_id = ? ORDER BY datum DESC, op DESC LIMIT 1')
          .get(id);
        return rij ? dagboekNaarBuiten(rij) : null;
      })(),
      fotoopslag: opslag.beschikbaar(),
    });
  });
};
