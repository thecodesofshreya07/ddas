const fs = require("fs");
const path = require("path");
const assert = require("assert");

async function runTests() {
  console.log("============================================================");
  console.log("  DDAS Regression & Verification Suite: Bug Fix + Signup + Attribution");
  console.log("============================================================");

  // Test 1: Bug Fix & Path B Priority verification
  console.log("\n[Test 1] Bug Fix — Verify no auto-resume timer in background.js & Path B Priority...");
  const bgCode = fs.readFileSync(path.resolve(__dirname, "../extension/background.js"), "utf-8");

  assert(!bgCode.includes("pendingDecisions.has(item.id)"), "Regression check: background.js must NOT contain any auto-resume timer calling suggest()");
  assert(!bgCode.includes("25000"), "Regression check: background.js must NOT contain any 25s auto-proceed timeout");
  assert(bgCode.includes("runDualPathCheck"), "Dual path function must exist");
  assert(bgCode.includes("checkServer"), "Central registry check must be called");
  assert(bgCode.includes("matchSource: \"registry\""), "All matches must be framed as registry");
  console.log("✓ Test 1 PASSED: 0 auto-resume timers found. Path B is authoritative primary.");


  // Test 2: User Store & Signup with bcrypt
  console.log("\n[Test 2] Signup & Bcrypt Hash in backend/data/users.json...");
  const testUsername = `user_${Date.now()}`;
  const testPassword = "securePassword123";
  const testDept = "Geospatial Intelligence";

  const signupRes = await fetch("http://localhost:4000/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: testUsername,
      password: testPassword,
      department: testDept,
      role: "user",
    }),
  });

  const signupData = await signupRes.json();
  assert.strictEqual(signupRes.status, 201, `Signup failed: ${JSON.stringify(signupData)}`);
  assert(signupData.token, "Signup must return JWT token");
  assert.strictEqual(signupData.user.username, testUsername);
  assert.strictEqual(signupData.user.department, testDept);

  // Verify users.json on disk
  const usersFile = path.resolve(__dirname, "data/users.json");
  assert(fs.existsSync(usersFile), "users.json must exist on disk at backend/data/users.json");


  const usersOnDisk = JSON.parse(fs.readFileSync(usersFile, "utf-8"));
  const foundUser = usersOnDisk.find((u) => u.username === testUsername);
  assert(foundUser, "User must be in users.json");
  assert(foundUser.passwordHash.startsWith("$2a$") || foundUser.passwordHash.startsWith("$2b$"), "Password must be bcrypt hash");
  assert(!JSON.stringify(foundUser).includes(testPassword), "Plaintext password must NEVER be in users.json");
  console.log(`✓ Test 2 PASSED: New user "${testUsername}" created with bcrypt hash in users.json`);

  // Test 3: Login with username and password
  console.log("\n[Test 3] Login with Username and Bcrypt Password Verification...");
  const loginRes = await fetch("http://localhost:4000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: testUsername,
      password: testPassword,
    }),
  });
  const loginData = await loginRes.json();
  assert.strictEqual(loginRes.status, 200, `Login failed: ${JSON.stringify(loginData)}`);
  assert(loginData.token, "Login must return JWT token");
  const authToken = loginData.token;
  console.log("✓ Test 3 PASSED: Authenticated successfully using username & bcrypt verification");

  // Test 4: Download Registration with Attribution
  console.log("\n[Test 4] Auto-Register Download with Attribution Metadata...");
  const testSha = `test_sha_${Date.now()}`;
  const registerRes = await fetch("http://localhost:4000/api/datasets/register-download", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      sha256: testSha,
      sizeBytes: 15400,
      filename: "satellite_survey_2024.csv",
      domain: "GIS",
      classification: "internal",
      periodStart: "2024-01-01",
      periodEnd: "2024-06-30",
      spatialRegionName: "Western Ghats",
    }),
  });
  const registerData = await registerRes.json();
  assert(registerRes.status === 200 || registerRes.status === 201, `Register failed: ${JSON.stringify(registerData)}`);
  assert(registerData.datasetId, "Must return dataset ID");

  console.log(`✓ Test 4 PASSED: Download registered under user "${testUsername}" (${testDept})`);

  // Test 5: Check duplicate & Verify Attribution in Alert Payload
  console.log("\n[Test 5] Verify Attribution in Pre-Download Check (Username, Location, Timestamp)...");
  const checkRes = await fetch("http://localhost:4000/api/datasets/check", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      sha256: testSha,
      sizeBytes: 15400,
      filename: "satellite_survey_2024.csv",
    }),
  });
  const checkData = await checkRes.json();
  assert.strictEqual(checkData.status, "exact_duplicate");
  assert.strictEqual(checkData.similarityScore, 100.0);
  assert.strictEqual(checkData.existing.hasAccess, true);
  assert(checkData.existing.downloaderUsername, "Must contain downloaderUsername");
  assert(checkData.existing.downloadLocation, "Must contain downloadLocation");
  assert(checkData.existing.downloadedAt, "Must contain downloadedAt timestamp");
  console.log("  Attribution received in alert:", {
    downloader: checkData.existing.downloaderUsername,
    location: checkData.existing.downloadLocation,
    timestamp: checkData.existing.downloadedAt,
  });
  console.log("✓ Test 5 PASSED: Full attribution returned for authorized user");

  // Test 6: ABAC Redaction for Restricted Datasets
  console.log("\n[Test 6] ABAC Redaction for Restricted Datasets (Identity & Location Protected)...");
  // Register restricted dataset under Dr. Kavita
  const kavitaLogin = await fetch("http://localhost:4000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "kavita@research.gov.in", password: "password123" }),
  });
  const { token: kavitaToken } = await kavitaLogin.json();

  const restrictedSha = `restricted_sha_${Date.now()}`;
  await fetch("http://localhost:4000/api/datasets/register-download", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${kavitaToken}`,
    },
    body: JSON.stringify({
      sha256: restrictedSha,
      sizeBytes: 42000,
      filename: "classified_survey.csv",
      domain: "Research",
      classification: "restricted",
    }),
  });

  // Regular user from Meteorology checks duplicate
  const rahulLogin = await fetch("http://localhost:4000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "rahul@meteorology.gov.in", password: "password123" }),
  });
  const { token: rahulToken } = await rahulLogin.json();

  const restrictedCheckRes = await fetch("http://localhost:4000/api/datasets/check", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rahulToken}`,
    },
    body: JSON.stringify({
      sha256: restrictedSha,
      sizeBytes: 42000,
      filename: "classified_survey.csv",
    }),
  });
  const restrictedCheckData = await restrictedCheckRes.json();
  assert.strictEqual(restrictedCheckData.existing.hasAccess, false, "Unauthorized user must have hasAccess = false");
  assert.strictEqual(restrictedCheckData.existing.downloaderUsername, null, "Downloader username must be REDACTED");
  assert.strictEqual(restrictedCheckData.existing.downloadLocation, null, "Download storage location must be REDACTED");
  assert.strictEqual(restrictedCheckData.existing.locationUrl, null, "Direct URL must be REDACTED");
  assert(restrictedCheckData.existing.restrictedNote, "Restricted note must be present");
  console.log("✓ Test 6 PASSED: Sensitive attribution & location safely redacted under ABAC");

  console.log("\n============================================================");
  console.log("  ALL TESTS PASSED SUCCESSFULLY! (6/6)");
  console.log("============================================================");
}

runTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
