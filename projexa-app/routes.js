'use strict';

/**
 * Projexa — API
 *
 * Twee soorten gebruikers, allebei met hun eigen ingang:
 *
 *   de eigenaar  — registreert met e-mailadres en wachtwoord, maakt projecten
 *                  aan en nodigt bedrijven uit
 *   de deelnemer — een uitgenodigd bedrijf, logt in met de projectcode en het
 *                  wachtwoord dat bij de uitnodiging is aangemaakt
 *
 * Een deelnemer hoort altijd bij precies één project; zijn sessie geeft hem
 * dus nooit toegang tot iets anders.
 */

const express = require('express');
const { db } = require('./db');
const A = require('./auth');

const router = express.Router();

/* -------------------------------------------------------------------------
   Hulpjes
   ------------------------------------------------------------------------- */

const nu = () => new Date().toISOString();
const tekst = (waarde, max) => String(waarde == null ? '' : waarde).trim().slice(0, max);

function geldigEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/** Vertaalt een projectrij naar wat de app ervan mag zien. */
function projectNaarBuiten(project, deelnemers) {
  return {
    id: project.id,
    naam: project.naam,
    adres: project.adres,
    aanneemsom: project.aanneemsom,
    start: project.start,
    oplevering: project.oplevering,
    voortgang: project.voortgang,
    status: project.status,
    afgeslotenOp: project.afgesloten_op,
    aangemaaktOp: project.aangemaakt_op,
    deelnemers: deelnemers || [],
  };
}

/** Deelnemer zonder wachtwoordhash — die verlaat de server nooit. */
function deelnemerNaarBuiten(d, extra) {
  return Object.assign(
    {
      id: d.id,
      bedrijfsnaam: d.bedrijfsnaam,
      rol: d.rol,
      contactpersoon: d.contactpersoon,
      email: d.email,
      code: d.code,
      uitgenodigdOp: d.uitgenodigd_op,
      laatstIngelogd: d.laatst_ingelogd,
    },
    extra || {}
  );
}

function deelnemersVanProject(projectId, voorEigenaar) {
  const rijen = db
    .prepare('SELECT * FROM deelnemers WHERE project_id = ? ORDER BY uitgenodigd_op')
    .all(projectId);

  const ongelezen = db.prepare(
    `SELECT COUNT(*) AS aantal FROM berichten
      WHERE deelnemer_id = ? AND van = ? AND ${voorEigenaar ? 'gelezen_door_eigenaar' : 'gelezen_door_deelnemer'} = 0`
  );

  const laatste = db.prepare(
    'SELECT tekst, op, van FROM berichten WHERE deelnemer_id = ? ORDER BY op DESC LIMIT 1'
  );

  return rijen.map((d) =>
    deelnemerNaarBuiten(d, {
      ongelezen: ongelezen.get(d.id, voorEigenaar ? 'deelnemer' : 'eigenaar').aantal,
      laatsteBericht: laatste.get(d.id) || null,
    })
  );
}

/* =========================================================================
   Eigenaar: registreren en inloggen
   ========================================================================= */

router.post('/registreren', (req, res) => {
  const naam = tekst(req.body.naam, 120);
  const email = tekst(req.body.email, 200).toLowerCase();
  const wachtwoord = String(req.body.wachtwoord || '');

  if (!naam) return res.status(400).json({ fout: 'Vul je naam in.' });
  if (!geldigEmail(email)) return res.status(400).json({ fout: 'Vul een geldig e-mailadres in.' });
  if (wachtwoord.length < 8) {
    return res.status(400).json({ fout: 'Kies een wachtwoord van minstens 8 tekens.' });
  }

  const bestaat = db.prepare('SELECT 1 FROM eigenaren WHERE email = ?').get(email);
  if (bestaat) {
    return res.status(409).json({ fout: 'Er bestaat al een account met dit e-mailadres. Log in.' });
  }

  const id = A.nieuwId('eig');
  db.prepare(
    'INSERT INTO eigenaren (id, naam, email, wachtwoord, aangemaakt_op) VALUES (?, ?, ?, ?, ?)'
  ).run(id, naam, email, A.hashWachtwoord(wachtwoord), nu());

  A.startSessie(res, 'eigenaar', id);
  res.json({ ok: true, eigenaar: { id, naam, email } });
});

router.post('/inloggen', (req, res) => {
  const email = tekst(req.body.email, 200).toLowerCase();
  const wachtwoord = String(req.body.wachtwoord || '');
  const teller = `eigenaar:${email}`;

  if (!A.magNogProberen(teller)) {
    return res.status(429).json({ fout: 'Te veel pogingen. Wacht tien minuten en probeer het opnieuw.' });
  }

  const eigenaar = db.prepare('SELECT * FROM eigenaren WHERE email = ?').get(email);

  // Bewust dezelfde melding voor een onbekend adres en een fout wachtwoord:
  // anders kun je uitvissen wie er een account heeft.
  if (!eigenaar || !A.klopWachtwoord(wachtwoord, eigenaar.wachtwoord)) {
    A.telMisluktePoging(teller);
    return res.status(401).json({ fout: 'Dit e-mailadres of wachtwoord klopt niet.' });
  }

  A.wisPogingen(teller);
  A.startSessie(res, 'eigenaar', eigenaar.id);
  res.json({ ok: true, eigenaar: { id: eigenaar.id, naam: eigenaar.naam, email: eigenaar.email } });
});

/* =========================================================================
   Deelnemer: inloggen met projectcode
   ========================================================================= */

router.post('/partner/inloggen', (req, res) => {
  const code = tekst(req.body.code, 40).toUpperCase();
  const wachtwoord = tekst(req.body.wachtwoord, 60).toUpperCase();
  const teller = `deelnemer:${code}`;

  if (!A.magNogProberen(teller)) {
    return res.status(429).json({ fout: 'Te veel pogingen. Wacht tien minuten en probeer het opnieuw.' });
  }

  const deelnemer = db.prepare('SELECT * FROM deelnemers WHERE code = ?').get(code);
  if (!deelnemer || !A.klopWachtwoord(wachtwoord, deelnemer.wachtwoord)) {
    A.telMisluktePoging(teller);
    return res.status(401).json({ fout: 'Deze projectcode en dit wachtwoord horen niet bij elkaar.' });
  }

  A.wisPogingen(teller);
  db.prepare('UPDATE deelnemers SET laatst_ingelogd = ? WHERE id = ?').run(nu(), deelnemer.id);
  A.startSessie(res, 'deelnemer', deelnemer.id);

  res.json({ ok: true, deelnemer: deelnemerNaarBuiten(deelnemer) });
});

/* =========================================================================
   Voor beide rollen
   ========================================================================= */

router.post('/uitloggen', (req, res) => {
  A.beeindigSessie(req, res);
  res.json({ ok: true });
});

/** Wie ben ik, en wat mag ik zien? De app haalt dit op bij het laden. */
router.get('/mij', (req, res) => {
  const sessie = A.huidigeSessie(req);
  if (!sessie) return res.json({ ingelogd: false });

  if (sessie.soort === 'eigenaar') {
    const projecten = db
      .prepare('SELECT * FROM projecten WHERE eigenaar_id = ? ORDER BY aangemaakt_op DESC')
      .all(sessie.eigenaar.id);

    return res.json({
      ingelogd: true,
      rol: 'eigenaar',
      eigenaar: sessie.eigenaar,
      projecten: projecten.map((p) => projectNaarBuiten(p, deelnemersVanProject(p.id, true))),
    });
  }

  const project = db.prepare('SELECT * FROM projecten WHERE id = ?').get(sessie.deelnemer.project_id);
  const eigenaar = project
    ? db.prepare('SELECT naam FROM eigenaren WHERE id = ?').get(project.eigenaar_id)
    : null;

  res.json({
    ingelogd: true,
    rol: 'deelnemer',
    deelnemer: deelnemerNaarBuiten(sessie.deelnemer),
    project: project ? projectNaarBuiten(project, deelnemersVanProject(project.id, false)) : null,
    eigenaarNaam: eigenaar ? eigenaar.naam : '',
  });
});

/* =========================================================================
   Projecten (eigenaar)
   ========================================================================= */

router.post('/projecten', A.alleenEigenaar, (req, res) => {
  const naam = tekst(req.body.naam, 120);
  if (!naam) return res.status(400).json({ fout: 'Geef je project een naam.' });

  const somRuw = String(req.body.aanneemsom || '').replace(/[^\d]/g, '');
  const id = A.nieuwId('prj');

  db.prepare(
    `INSERT INTO projecten (id, eigenaar_id, naam, adres, aanneemsom, start, oplevering, voortgang, status, aangemaakt_op)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'lopend', ?)`
  ).run(
    id,
    req.eigenaar.id,
    naam,
    tekst(req.body.adres, 200),
    somRuw ? Number(somRuw) : null,
    tekst(req.body.start, 40),
    tekst(req.body.oplevering, 40),
    nu()
  );

  const project = db.prepare('SELECT * FROM projecten WHERE id = ?').get(id);
  res.json({ ok: true, project: projectNaarBuiten(project, []) });
});

router.get('/projecten/:id', A.alleenEigenaar, (req, res) => {
  const project = A.projectVanEigenaar(req.params.id, req.eigenaar.id);
  if (!project) return res.status(404).json({ fout: 'Project niet gevonden.' });
  res.json({ project: projectNaarBuiten(project, deelnemersVanProject(project.id, true)) });
});

router.patch('/projecten/:id', A.alleenEigenaar, (req, res) => {
  const project = A.projectVanEigenaar(req.params.id, req.eigenaar.id);
  if (!project) return res.status(404).json({ fout: 'Project niet gevonden.' });
  if (project.status === 'afgesloten') {
    return res.status(409).json({ fout: 'Dit project is afgesloten en kan niet meer worden gewijzigd.' });
  }

  const velden = {
    naam: (w) => tekst(w, 120) || project.naam,
    adres: (w) => tekst(w, 200),
    start: (w) => tekst(w, 40),
    oplevering: (w) => tekst(w, 40),
    aanneemsom: (w) => {
      const cijfers = String(w || '').replace(/[^\d]/g, '');
      return cijfers ? Number(cijfers) : null;
    },
    voortgang: (w) => Math.max(0, Math.min(100, Number(w) || 0)),
  };

  for (const [veld, schoon] of Object.entries(velden)) {
    if (veld in req.body) {
      db.prepare(`UPDATE projecten SET ${veld} = ? WHERE id = ?`).run(schoon(req.body[veld]), project.id);
    }
  }

  const bijgewerkt = db.prepare('SELECT * FROM projecten WHERE id = ?').get(project.id);
  res.json({ ok: true, project: projectNaarBuiten(bijgewerkt, deelnemersVanProject(project.id, true)) });
});

/** Afsluiten bij oplevering: daarna kan niemand er nog iets aan veranderen. */
router.post('/projecten/:id/afsluiten', A.alleenEigenaar, (req, res) => {
  const project = A.projectVanEigenaar(req.params.id, req.eigenaar.id);
  if (!project) return res.status(404).json({ fout: 'Project niet gevonden.' });
  if (project.status === 'afgesloten') {
    return res.status(409).json({ fout: 'Dit project is al afgesloten.' });
  }

  db.prepare("UPDATE projecten SET status = 'afgesloten', afgesloten_op = ?, voortgang = 100 WHERE id = ?")
    .run(nu(), project.id);

  const bijgewerkt = db.prepare('SELECT * FROM projecten WHERE id = ?').get(project.id);
  res.json({ ok: true, project: projectNaarBuiten(bijgewerkt, deelnemersVanProject(project.id, true)) });
});

/* =========================================================================
   Deelnemers uitnodigen (eigenaar)
   ========================================================================= */

router.post('/projecten/:id/deelnemers', A.alleenEigenaar, (req, res) => {
  const project = A.projectVanEigenaar(req.params.id, req.eigenaar.id);
  if (!project) return res.status(404).json({ fout: 'Project niet gevonden.' });
  if (project.status === 'afgesloten') {
    return res.status(409).json({ fout: 'Dit project is afgesloten; je kunt niemand meer uitnodigen.' });
  }

  const bedrijfsnaam = tekst(req.body.bedrijfsnaam, 120);
  if (!bedrijfsnaam) return res.status(400).json({ fout: 'Vul de bedrijfsnaam in.' });

  const id = A.nieuwId('dln');
  const code = A.nieuweCode();
  const wachtwoord = A.nieuwWachtwoord();

  db.prepare(
    `INSERT INTO deelnemers
       (id, project_id, bedrijfsnaam, rol, contactpersoon, email, code, wachtwoord, uitgenodigd_op)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    project.id,
    bedrijfsnaam,
    tekst(req.body.rol, 60),
    tekst(req.body.contactpersoon, 120),
    tekst(req.body.email, 200).toLowerCase(),
    code,
    A.hashWachtwoord(wachtwoord),
    nu()
  );

  const deelnemer = db.prepare('SELECT * FROM deelnemers WHERE id = ?').get(id);

  // Het wachtwoord staat gehasht in de database en is hierna niet meer op te
  // vragen — de eigenaar krijgt het nu één keer te zien om door te geven.
  res.json({
    ok: true,
    deelnemer: deelnemerNaarBuiten(deelnemer, { ongelezen: 0, laatsteBericht: null }),
    inlog: { code, wachtwoord },
  });
});

router.post('/deelnemers/:id/nieuw-wachtwoord', A.alleenEigenaar, (req, res) => {
  const deelnemer = db.prepare('SELECT * FROM deelnemers WHERE id = ?').get(req.params.id);
  if (!deelnemer) return res.status(404).json({ fout: 'Deelnemer niet gevonden.' });
  if (!A.projectVanEigenaar(deelnemer.project_id, req.eigenaar.id)) {
    return res.status(404).json({ fout: 'Deelnemer niet gevonden.' });
  }

  const wachtwoord = A.nieuwWachtwoord();
  db.prepare('UPDATE deelnemers SET wachtwoord = ? WHERE id = ?').run(A.hashWachtwoord(wachtwoord), deelnemer.id);

  // Zijn oude sessies vervallen: een nieuw wachtwoord hoort iemand er ook uit te zetten.
  db.prepare("DELETE FROM sessies WHERE soort = 'deelnemer' AND persoon_id = ?").run(deelnemer.id);

  res.json({ ok: true, inlog: { code: deelnemer.code, wachtwoord } });
});

router.delete('/deelnemers/:id', A.alleenEigenaar, (req, res) => {
  const deelnemer = db.prepare('SELECT * FROM deelnemers WHERE id = ?').get(req.params.id);
  if (!deelnemer) return res.status(404).json({ fout: 'Deelnemer niet gevonden.' });
  if (!A.projectVanEigenaar(deelnemer.project_id, req.eigenaar.id)) {
    return res.status(404).json({ fout: 'Deelnemer niet gevonden.' });
  }

  db.prepare("DELETE FROM sessies WHERE soort = 'deelnemer' AND persoon_id = ?").run(deelnemer.id);
  db.prepare('DELETE FROM deelnemers WHERE id = ?').run(deelnemer.id);

  res.json({ ok: true });
});

/* =========================================================================
   Berichten
   ========================================================================= */

/** Bepaalt met welk gesprek je te maken hebt, en of je erbij mag. */
function gesprekVoorVerzoek(req) {
  const sessie = A.huidigeSessie(req);
  if (!sessie) return { fout: 401, melding: 'Log eerst in.' };

  if (sessie.soort === 'deelnemer') {
    const deelnemer = sessie.deelnemer;
    // Een deelnemer heeft maar één gesprek: dat met de eigenaar van zijn project.
    if (req.params.deelnemerId && req.params.deelnemerId !== deelnemer.id) {
      return { fout: 403, melding: 'Je kunt alleen je eigen gesprek zien.' };
    }
    const project = db.prepare('SELECT * FROM projecten WHERE id = ?').get(deelnemer.project_id);
    return { rol: 'deelnemer', deelnemer, project };
  }

  const deelnemer = db.prepare('SELECT * FROM deelnemers WHERE id = ?').get(req.params.deelnemerId);
  if (!deelnemer) return { fout: 404, melding: 'Gesprek niet gevonden.' };

  const project = A.projectVanEigenaar(deelnemer.project_id, sessie.eigenaar.id);
  if (!project) return { fout: 404, melding: 'Gesprek niet gevonden.' };

  return { rol: 'eigenaar', deelnemer, project };
}

router.get('/gesprekken/:deelnemerId', (req, res) => {
  const g = gesprekVoorVerzoek(req);
  if (g.fout) return res.status(g.fout).json({ fout: g.melding });

  const berichten = db
    .prepare('SELECT id, van, tekst, op FROM berichten WHERE deelnemer_id = ? ORDER BY op')
    .all(g.deelnemer.id);

  // Openen is lezen.
  const kolom = g.rol === 'eigenaar' ? 'gelezen_door_eigenaar' : 'gelezen_door_deelnemer';
  const vanDeAnder = g.rol === 'eigenaar' ? 'deelnemer' : 'eigenaar';
  db.prepare(`UPDATE berichten SET ${kolom} = 1 WHERE deelnemer_id = ? AND van = ?`)
    .run(g.deelnemer.id, vanDeAnder);

  res.json({
    berichten,
    deelnemer: deelnemerNaarBuiten(g.deelnemer),
    project: g.project ? { id: g.project.id, naam: g.project.naam, status: g.project.status } : null,
  });
});

router.post('/gesprekken/:deelnemerId', (req, res) => {
  const g = gesprekVoorVerzoek(req);
  if (g.fout) return res.status(g.fout).json({ fout: g.melding });

  if (g.project && g.project.status === 'afgesloten') {
    return res.status(409).json({ fout: 'Dit project is afgesloten. Je kunt het gesprek nog teruglezen.' });
  }

  const inhoud = tekst(req.body.tekst, 4000);
  if (!inhoud) return res.status(400).json({ fout: 'Je bericht is leeg.' });

  const bericht = {
    id: A.nieuwId('ber'),
    project_id: g.deelnemer.project_id,
    deelnemer_id: g.deelnemer.id,
    van: g.rol,
    tekst: inhoud,
    op: nu(),
  };

  db.prepare(
    `INSERT INTO berichten
       (id, project_id, deelnemer_id, van, tekst, op, gelezen_door_eigenaar, gelezen_door_deelnemer)
     VALUES (@id, @project_id, @deelnemer_id, @van, @tekst, @op, ?, ?)`
  ).run(bericht, g.rol === 'eigenaar' ? 1 : 0, g.rol === 'deelnemer' ? 1 : 0);

  res.json({ ok: true, bericht: { id: bericht.id, van: bericht.van, tekst: bericht.tekst, op: bericht.op } });
});

module.exports = router;
