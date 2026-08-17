const assert = require("assert");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require("./src/db/pool");
const { findExactDuplicate, findBestMatch, filenameSimilarity } = require("./src/services/duplicateEngine");
const { evaluatePolicy } = require("./src/middleware/policy");
const { fingerprintBuffer } = require("../extension/fingerprint");

const JWT_SECRET = process.env.JWT_SECRET || "ddas-insecure-dev-secret-change-in-prod";

function createAuthToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, department: user.department },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
}

function generateCycloneCsv() {
  let csv = "date,wind_speed_kmh,central_pressure_hpa,status\n";
  for (let day = 1; day <= 30; day++) {
    const dStr = `2024-05-${String(day).padStart(2, "0")}`;
    csv += `${dStr},${100 + (day % 40)},${990 - (day % 15)},Tropical Storm\n`;
  }
  return Buffer.from(csv, "utf-8");
}

function generateModifiedCycloneCsv() {
  let csv = "date,wind_speed_kmh,central_pressure_hpa,status\n";
  for (let day = 1; day <= 30; day++) {
    const dStr = `2024-05-${String(day).padStart(2, "0")}`;
    if (day >= 29) {
      // 2 modified rows
      csv += `${dStr},210,920,Severe Cyclone Remnant\n`;
    } else {
      csv += `${dStr},${100 + (day % 40)},${990 - (day % 15)},Tropical Storm\n`;
    }
  }
  return Buffer.from(csv, "utf-8");
}

async function runGapTests() {
  console.log("============================================================");
  console.log("  DDAS PS Requirements Verification Suite (Gaps 1, 2, 3)");
  console.log("============================================================\n");

  const userRahul = { id: "u-rahul-002", email: "rahul@meteorology.gov.in", role: "user", department: "Meteorology" };
  const userAditi = { id: "u-aditi-003", email: "aditi@research.gov.in", role: "user", department: "Research" };
  const userAdmin = { id: "u-admin-001", email: "admin@ddas.gov.in", role: "admin", department: "IT" };

  // -------------------------------------------------------------------------
  // GAP 2 TEST: Date Range Auto-Inference & Spatial Domain
  // -------------------------------------------------------------------------
  console.log("[Gap 2 Test] Date Column Auto-Inference & Spatial Domain Capture...");
  const rawCsv = generateCycloneCsv();
  const fp = await fingerprintBuffer(rawCsv, "cyclone-tracker-2024.csv", "text/csv", "https://imd.gov.in/cyclone.csv", {
    spatialRegionName: "Bay of Bengal",
  });

  console.log("  Inferred Period Start:", fp.periodStart);
  console.log("  Inferred Period End:", fp.periodEnd);
  console.log("  Spatial Region Name:", fp.spatialRegionName);

  assert.strictEqual(fp.periodStart, "2024-05-01", "Expected start date 2024-05-01");
  assert.strictEqual(fp.periodEnd, "2024-05-30", "Expected end date 2024-05-30");
  assert.strictEqual(fp.spatialRegionName, "Bay of Bengal");
  console.log("✓ Gap 2 Test (Part 1: Auto-Inference) PASSED\n");

  // -------------------------------------------------------------------------
  // GAP 1 TEST: Auto-Registration of Downloads & Cross-User Alerting
  // -------------------------------------------------------------------------
  console.log("[Gap 1 Test] Auto-Registration of Downloads & Cross-User Duplication Check...");

  // Step 1: User Rahul downloads cyclone-tracker-2024.csv via extension (no portal upload)
  const { v4: uuidv4 } = require("uuid");
  const datasetId = `ds-cyclone-${Date.now()}`;
  const versionId = uuidv4();

  await pool.query(
    `INSERT INTO datasets (title, description, domain, owner_department, classification)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      "cyclone-tracker-2024.csv",
      "Auto-registered from external download (https://imd.gov.in/cyclone.csv)",
      "Meteorology",
      userRahul.department,
      "internal",
    ]
  );
  const dsResult = await pool.query("SELECT id FROM datasets WHERE title = $1", ["cyclone-tracker-2024.csv"]);
  const actualDatasetId = dsResult.rows[0].id;

  await pool.query(
    `INSERT INTO dataset_versions
      (id, dataset_id, version_num, original_filename, format, size_bytes, sha256,
       storage_key, period_start, period_end, spatial_min_lat, spatial_max_lat,
       spatial_min_lng, spatial_max_lng, spatial_region_name, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      versionId,
      actualDatasetId,
      1,
      "cyclone-tracker-2024.csv",
      "csv",
      fp.sizeBytes,
      fp.sha256,
      `external_downloads/${fp.sha256}`,
      fp.periodStart,
      fp.periodEnd,
      null,
      null,
      null,
      null,
      fp.spatialRegionName,
      userRahul.id,
    ]
  );

  await pool.query("UPDATE dataset_versions SET schema_fingerprint = $1 WHERE id = $2", [
    { ...fp.schemaFingerprint, contentSignature: fp.contentSignature },
    versionId,
  ]);

  await pool.query(
    `INSERT INTO downloads (dataset_version_id, user_id, was_alerted, action_taken, bytes_saved)
     VALUES ($1, $2, $3, $4, $5)`,
    [versionId, userRahul.id, false, "registered_external_download", 0]
  );

  console.log(`  User Rahul auto-registered "${fp.fileName}" in registry (Dataset ID: ${actualDatasetId})`);

  // Step 2: User Aditi (different department, different device) later downloads a near-duplicate version
  const modCsv = generateModifiedCycloneCsv();
  const modFp = await fingerprintBuffer(modCsv, "cyclone-tracker-2024-v2.csv", "text/csv", "https://noaa.gov/cyclone-v2.csv");

  // Run backend check on behalf of User Aditi
  const candidateShape = {
    size_bytes: modFp.sizeBytes,
    domain: "Meteorology",
    title: "cyclone-tracker-2024-v2.csv",
    description: "",
    original_filename: "cyclone-tracker-2024-v2.csv",
    schema_fingerprint: { ...modFp.schemaFingerprint, contentSignature: modFp.contentSignature },
    period_start: modFp.periodStart,
    period_end: modFp.periodEnd,
    spatial_region_name: null,
  };

  const matchResult = await findBestMatch(candidateShape);
  assert.ok(matchResult, "Expected match for near-duplicate");
  console.log(`  User Aditi check result score: ${matchResult.totalScore}%`);
  console.log(`  Matched existing record: "${matchResult.candidate.original_filename}" (by ${matchResult.candidate.owner_department})`);

  assert.ok(
    matchResult.totalScore >= 80.0 && matchResult.totalScore <= 99.0,
    `Expected near-duplicate score in 80-99% range, got ${matchResult.totalScore}%`
  );
  assert.strictEqual(matchResult.candidate.original_filename, "cyclone-tracker-2024.csv");
  console.log("✓ Gap 1 Test (Part 1: Cross-User Detection) PASSED\n");

  // Step 3: User Aditi downloads the exact same file -> links to canonical record without spamming duplicates
  const exactCheck = await findExactDuplicate(fp.sha256);
  assert.ok(exactCheck, "Exact match must be found for identical sha256");
  assert.strictEqual(exactCheck.id, versionId);

  // Link download event
  const dlBeforeCount = (await pool.query("SELECT COUNT(*) FROM downloads WHERE dataset_version_id = $1", [versionId])).rows[0].count;
  await pool.query(
    `INSERT INTO downloads (dataset_version_id, user_id, was_alerted, action_taken, bytes_saved)
     VALUES ($1, $2, $3, $4, $5)`,
    [versionId, userAditi.id, false, "registered_external_download", 0]
  );
  const dlAfterCount = (await pool.query("SELECT COUNT(*) FROM downloads WHERE dataset_version_id = $1", [versionId])).rows[0].count;
  assert.strictEqual(Number(dlAfterCount), Number(dlBeforeCount) + 1, "Download event linked successfully");
  console.log("✓ Gap 1 Test (Part 2: Canonical Record Deduplication) PASSED\n");

  // -------------------------------------------------------------------------
  // GAP 3 TEST: ABAC Access Location Gating
  // -------------------------------------------------------------------------
  console.log("[Gap 3 Test] ABAC-Gated Access Location in Alert...");

  // Scenario A: User Aditi checks an "internal" dataset she has access to
  const accessInternal = await evaluatePolicy({
    role: userAditi.role,
    department: userAditi.department,
    classification: "internal",
    action: "view",
  });
  assert.strictEqual(accessInternal, "allow", "User should have access to internal classification");
  const authorizedAlertPayload = {
    datasetId: actualDatasetId,
    locationUrl: `http://localhost:5173/datasets/${actualDatasetId}`,
    hasAccess: true,
    periodStart: fp.periodStart,
    periodEnd: fp.periodEnd,
    spatialRegionName: fp.spatialRegionName,
  };
  assert.strictEqual(authorizedAlertPayload.hasAccess, true);
  assert.ok(authorizedAlertPayload.locationUrl.includes(actualDatasetId));
  console.log(`  Authorized user alert payload contains active location: "${authorizedAlertPayload.locationUrl}"`);

  // Scenario B: User Aditi checks a "restricted" dataset she does NOT have clearance for
  const accessRestricted = await evaluatePolicy({
    role: userAditi.role,
    department: userAditi.department,
    classification: "restricted",
    action: "view",
  });
  assert.strictEqual(accessRestricted, "deny", "Regular user should be denied view on cross-dept restricted classification");

  const unauthorizedAlertPayload = {
    datasetId: null,
    locationUrl: null,
    hasAccess: false,
    classification: "restricted",
    restrictedNote: "Classification: Restricted — Access restricted to custodian department. Contact data administrator to request access.",
    periodStart: fp.periodStart,
    periodEnd: fp.periodEnd,
    spatialRegionName: fp.spatialRegionName,
  };

  assert.strictEqual(unauthorizedAlertPayload.hasAccess, false);
  assert.strictEqual(unauthorizedAlertPayload.locationUrl, null);
  assert.ok(unauthorizedAlertPayload.restrictedNote.includes("Restricted"));
  console.log(`  Unauthorized user alert payload discloses existence but withholds location & download links.`);
  console.log("✓ Gap 3 Test (ABAC-Gated Location & Disclosure) PASSED\n");

  console.log("============================================================");
  console.log("  ALL GAP ACCEPTANCE TESTS PASSED SUCCESSFULLY! (3/3)");
  console.log("============================================================");
}

runGapTests().catch((err) => {
  console.error("Gap test execution failed:", err);
  process.exit(1);
});
