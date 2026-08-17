const crypto = require("crypto");
const pool = require("../db/pool");

/**
 * Tamper-evident audit log.
 *
 * Every event's `this_hash` is sha256(prev_hash + canonicalJSON(event)).
 * Because each row commits to the hash of the row before it, altering any
 * historical row changes its hash and breaks every subsequent link in the
 * chain — which `verifyChain()` below can detect deterministically.
 *
 * This runs inside the same transaction as the action it's logging where
 * possible, so "the action happened" and "it was audited" are atomic.
 */

function canonicalize(obj) {
  // Stable stringify so hashing is deterministic regardless of key order.
  return JSON.stringify(obj, Object.keys(obj).sort());
}

async function getLastHash(client) {
  const { rows } = await client.query(
    "SELECT this_hash FROM audit_log ORDER BY id DESC LIMIT 1"
  );
  if (rows.length === 0) {
    return "0".repeat(64);
  }
  return rows[0].this_hash;
}

/**
 * @param {object} event { event_type, actor_id, resource_type, resource_id, details }
 * @param {import('pg').PoolClient} [client] optional transaction client
 */
async function recordEvent(event, client = pool) {
  const prevHash = await getLastHash(client);

  const payload = {
    event_type: event.event_type,
    actor_id: event.actor_id || null,
    resource_type: event.resource_type || null,
    resource_id: event.resource_id || null,
    details: event.details || {},
    prev_hash: prevHash,
  };

  const thisHash = crypto
    .createHash("sha256")
    .update(prevHash + canonicalize(payload))
    .digest("hex");

  await client.query(
    `INSERT INTO audit_log
      (event_type, actor_id, resource_type, resource_id, details, prev_hash, this_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      event.event_type,
      event.actor_id || null,
      event.resource_type || null,
      event.resource_id || null,
      event.details || {},
      prevHash,
      thisHash,
    ]
  );

  return thisHash;
}

/**
 * Walks the entire chain and verifies no row has been tampered with.
 * Useful as a live demo: "here's proof the log hasn't been altered."
 */
async function verifyChain() {
  const { rows } = await pool.query(
    "SELECT id, event_type, actor_id, resource_type, resource_id, details, prev_hash, this_hash FROM audit_log ORDER BY id ASC"
  );

  let expectedPrev = "0".repeat(64);
  for (const row of rows) {
    if (row.prev_hash !== expectedPrev) {
      return { valid: false, brokenAt: row.id, reason: "prev_hash mismatch" };
    }
    const payload = {
      event_type: row.event_type,
      actor_id: row.actor_id,
      resource_type: row.resource_type,
      resource_id: row.resource_id,
      details: row.details,
      prev_hash: row.prev_hash,
    };
    const recomputed = crypto
      .createHash("sha256")
      .update(row.prev_hash + canonicalize(payload))
      .digest("hex");

    if (recomputed !== row.this_hash) {
      return { valid: false, brokenAt: row.id, reason: "hash mismatch" };
    }
    expectedPrev = row.this_hash;
  }

  return { valid: true, rowsVerified: rows.length };
}

module.exports = { recordEvent, verifyChain };
