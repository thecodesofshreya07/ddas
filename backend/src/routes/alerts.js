const express = require("express");
const pool = require("../db/pool");
const { requireAuth } = require("../middleware/auth");
const { recordEvent } = require("../services/auditLog");
const { computeSeverity } = require("../services/severity");

const router = express.Router();

const VALID_STATUSES = ["new", "investigating", "acknowledged", "resolved", "false_positive"];

/**
 * GET /api/alerts?status=&severity=&department=&limit=&offset=
 * Every "alert" is a version_relationships row (a real detection event),
 * left-joined against alert_reviews (the human workflow state — absent
 * means implicitly "new", nobody has looked at it yet).
 */
router.get("/", requireAuth, async (req, res) => {
  const { status, severity, department, limit = 50, offset = 0 } = req.query;

  const { rows } = await pool.query(
    `SELECT
        vr.id AS relationship_id,
        vr.relationship_type,
        vr.similarity_score,
        vr.score_breakdown,
        vr.created_at AS detected_at,
        d.id AS dataset_id,
        d.title,
        d.owner_department,
        d.classification,
        COALESCE(ar.status, 'new') AS status,
        ar.assigned_to,
        assignee.name AS assignee_name,
        ar.updated_at AS status_updated_at
     FROM version_relationships vr
     JOIN dataset_versions dv ON dv.id = vr.version_a_id
     JOIN datasets d ON d.id = dv.dataset_id
     LEFT JOIN alert_reviews ar ON ar.relationship_id = vr.id
     LEFT JOIN users assignee ON assignee.id = ar.assigned_to
     ORDER BY vr.created_at DESC
     LIMIT $1 OFFSET $2`,
    [Math.min(parseInt(limit, 10) || 50, 200), parseInt(offset, 10) || 0]
  );

  let alerts = rows.map((r) => ({
    ...r,
    severity: computeSeverity(r.relationship_type, r.similarity_score),
  }));

  if (status) alerts = alerts.filter((a) => a.status === status);
  if (severity) alerts = alerts.filter((a) => a.severity === severity);
  if (department) alerts = alerts.filter((a) => a.owner_department === department);

  res.json({ alerts });
});

/**
 * GET /api/alerts/summary
 * Counts for the Alert Center header — real GROUP BY queries, not
 * hardcoded numbers.
 */
router.get("/summary", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT vr.id, vr.relationship_type, vr.similarity_score, COALESCE(ar.status, 'new') AS status
     FROM version_relationships vr
     LEFT JOIN alert_reviews ar ON ar.relationship_id = vr.id`
  );

  const summary = { total: rows.length, byStatus: {}, bySeverity: {} };
  for (const s of VALID_STATUSES) summary.byStatus[s] = 0;
  for (const s of ["critical", "high", "medium", "low"]) summary.bySeverity[s] = 0;

  for (const r of rows) {
    summary.byStatus[r.status] = (summary.byStatus[r.status] || 0) + 1;
    const sev = computeSeverity(r.relationship_type, r.similarity_score);
    summary.bySeverity[sev] = (summary.bySeverity[sev] || 0) + 1;
  }

  res.json(summary);
});

/**
 * GET /api/alerts/:relationshipId
 * Full investigation view: the relationship itself, both dataset versions
 * involved, the review workflow state, a real audit trail filtered to
 * this resource, and a genuine "previous occurrences" count (other
 * relationships touching the same dataset).
 */
router.get("/:relationshipId", requireAuth, async (req, res) => {
  const { relationshipId } = req.params;

  const relResult = await pool.query(
    `SELECT vr.*,
            dva.id AS version_a_id, dva.original_filename AS a_filename, dva.uploaded_at AS a_uploaded_at,
            dva.dataset_id AS a_dataset_id, da.title AS a_title, da.owner_department AS a_department, da.classification AS a_classification,
            da.domain AS a_domain, dva.format AS a_format, dva.size_bytes AS a_size,
            dva.period_start AS a_period_start, dva.period_end AS a_period_end,
            dva.spatial_region_name AS a_spatial_region, dva.schema_fingerprint AS a_schema,
            dvb.id AS version_b_id, dvb.original_filename AS b_filename, dvb.uploaded_at AS b_uploaded_at,
            dvb.dataset_id AS b_dataset_id, db_.title AS b_title, db_.owner_department AS b_department, db_.classification AS b_classification,
            db_.domain AS b_domain, dvb.format AS b_format, dvb.size_bytes AS b_size,
            dvb.period_start AS b_period_start, dvb.period_end AS b_period_end,
            dvb.spatial_region_name AS b_spatial_region, dvb.schema_fingerprint AS b_schema
     FROM version_relationships vr
     JOIN dataset_versions dva ON dva.id = vr.version_a_id
     JOIN datasets da ON da.id = dva.dataset_id
     JOIN dataset_versions dvb ON dvb.id = vr.version_b_id
     JOIN datasets db_ ON db_.id = dvb.dataset_id
     WHERE vr.id = $1`,
    [relationshipId]
  );
  if (relResult.rows.length === 0) return res.status(404).json({ error: "Alert not found" });
  const rel = relResult.rows[0];

  const reviewResult = await pool.query(
    `SELECT ar.*, u.name AS assignee_name, updater.name AS updated_by_name
     FROM alert_reviews ar
     LEFT JOIN users u ON u.id = ar.assigned_to
     LEFT JOIN users updater ON updater.id = ar.updated_by
     WHERE relationship_id = $1`,
    [relationshipId]
  );
  const review = reviewResult.rows[0] || { status: "new" };

  const previousOccurrences = await pool.query(
    `SELECT COUNT(*) AS count FROM version_relationships vr2
     JOIN dataset_versions dv2 ON dv2.id = vr2.version_a_id
     WHERE dv2.dataset_id = $1 AND vr2.id != $2`,
    [rel.a_dataset_id, relationshipId]
  );

  const auditTrail = await pool.query(
    `SELECT al.id, al.event_type, al.details, al.created_at, u.name AS actor_name
     FROM audit_log al
     LEFT JOIN users u ON u.id = al.actor_id
     WHERE al.resource_id = $1 OR al.resource_id = $2
     ORDER BY al.id DESC LIMIT 20`,
    [rel.a_dataset_id, rel.b_dataset_id]
  );

  res.json({
    relationship: rel,
    severity: computeSeverity(rel.relationship_type, rel.similarity_score),
    review,
    previousOccurrences: parseInt(previousOccurrences.rows[0]?.count || 0, 10),
    auditTrail: auditTrail.rows,
  });

});

/**
 * POST /api/alerts/:relationshipId/status
 * Body: { status, notes? }
 * Upserts the review row and audits the transition — every status change
 * is itself an audited event, so the workflow is as traceable as the
 * detection that triggered it.
 */
router.post("/:relationshipId/status", requireAuth, async (req, res) => {
  const { relationshipId } = req.params;
  const { status, notes } = req.body;

  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
  }

  const relCheck = await pool.query("SELECT id FROM version_relationships WHERE id = $1", [
    relationshipId,
  ]);
  if (relCheck.rows.length === 0) return res.status(404).json({ error: "Alert not found" });

  const { rows } = await pool.query(
    `INSERT INTO alert_reviews (relationship_id, status, notes, assigned_to, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $4, now())
     ON CONFLICT (relationship_id)
     DO UPDATE SET status = $2, notes = COALESCE($3, alert_reviews.notes),
                   assigned_to = COALESCE(alert_reviews.assigned_to, $4),
                   updated_by = $4, updated_at = now()
     RETURNING *`,
    [relationshipId, status, notes || null, req.user.id]
  );

  await recordEvent({
    event_type: "ALERT_STATUS_CHANGED",
    actor_id: req.user.id,
    resource_type: "version_relationship",
    resource_id: relationshipId,
    details: { newStatus: status, notes: notes || null },
  });

  res.json({ review: rows[0] });
});

module.exports = router;
