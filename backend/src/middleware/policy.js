const pool = require("../db/pool");
const { recordEvent } = require("../services/auditLog");

/**
 * Attribute-based access control.
 *
 * Every sensitive action (view / download / reuse) is evaluated against the
 * `access_policies` table using: role, department, dataset classification,
 * and the action being performed. Deny-by-default: if no matching "allow"
 * row exists, access is refused and the attempt is audited.
 *
 * Critically: for restricted/confidential datasets, an unauthorized user
 * must NOT be able to distinguish "doesn't exist" from "exists but you
 * can't see it" — both return 404, never 403, to avoid leaking existence
 * of sensitive datasets (this mirrors the doc's metadata-leakage concern).
 */
async function evaluatePolicy({ role, department, classification, action }) {
  const { rows } = await pool.query(
    `SELECT effect FROM access_policies
     WHERE role IN ($1, '*')
       AND (department IS NULL OR department = $2)
       AND classification = $3
       AND action = $4
     ORDER BY effect DESC -- explicit deny wins if both exist
     LIMIT 1`,
    [role, department, classification, action]
  );

  if (rows.length === 0) return "deny"; // deny-by-default
  return rows[0].effect;
}

/**
 * Express middleware factory. Expects the route handler to have already
 * loaded the resource and attached it as req.resource = { classification, owner_department, id, ... }
 * before calling next() — or use `loadDatasetAndEnforce` below for the
 * common case of a :datasetId param.
 */
function enforce(action) {
  return async (req, res, next) => {
    const resource = req.resource;
    if (!resource) {
      return res.status(500).json({ error: "Policy check called before resource was loaded" });
    }

    const effect = await evaluatePolicy({
      role: req.user.role,
      department: req.user.department,
      classification: resource.classification,
      action,
    });

    if (effect !== "allow") {
      await recordEvent({
        event_type: "ACCESS_DENIED",
        actor_id: req.user.id,
        resource_type: "dataset",
        resource_id: resource.id,
        details: { action, classification: resource.classification },
      });
      // 404, not 403 — do not confirm existence of restricted resources
      return res.status(404).json({ error: "Not found" });
    }

    next();
  };
}

module.exports = { evaluatePolicy, enforce };
