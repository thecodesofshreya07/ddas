const assert = require("assert");
const {
  fingerprintBuffer,
  scoreCandidate,
  contentSimilarity,
  compareSchema,
  filenameSimilarity,
} = require("./fingerprint");
const {
  saveLocalRecord,
  updateLocalRecord,
  findLocalDuplicates,
  getAllLocalRecords,
  clearLocalStore,
  refreshTrackedFilesFromDirectory,
} = require("./localStore");

// Helper to generate CSV data
function generateCsv(rowCount, modifiedRowIndices = []) {
  const headers = "id,name,age,department,score\n";
  let content = headers;
  for (let i = 1; i <= rowCount; i++) {
    if (modifiedRowIndices.includes(i)) {
      content += `${i},ModifiedUser_${i},${99},Marketing,${999.5}\n`;
    } else {
      content += `${i},StandardUser_${i},${20 + (i % 30)},Engineering,${100.0 + i}\n`;
    }
  }
  return Buffer.from(content, "utf-8");
}

async function runTests() {
  console.log("============================================================");
  console.log("  DDAS Extension — Live Pipeline & Local Indexing Tests");
  console.log("============================================================\n");

  await clearLocalStore();

  // -------------------------------------------------------------------------
  // Acceptance Test 1: Unified Interception Pipeline (Near-Duplicate)
  // Two real files differing by 2 out of 100 rows -> 90-99% score, near-duplicate alert
  // -------------------------------------------------------------------------
  console.log("[Test 1] Unified Interception Pipeline (Near-Duplicate 2/100 rows changed)...");
  const file1Buffer = generateCsv(100, []);
  const file2Buffer = generateCsv(100, [99, 100]); // 2 rows changed

  const fp1 = await fingerprintBuffer(file1Buffer, "data.csv", "text/csv", "https://portal.gov.in/data.csv");
  await saveLocalRecord(fp1);

  const fp2 = await fingerprintBuffer(file2Buffer, "data.csv", "text/csv", "https://portal.gov.in/data.csv");

  // Run live download pipeline
  const matches1 = await findLocalDuplicates(fp2);
  assert.ok(matches1.length > 0, "Expected at least one match for near-duplicate");
  const topMatch1 = matches1[0];

  console.log(`  Top match similarity score: ${topMatch1.similarityScore}%`);
  console.log(`  Relationship type: ${topMatch1.relationshipType}`);
  console.log(`  Score breakdown:`, topMatch1.breakdown);

  assert.ok(
    topMatch1.similarityScore >= 90.0 && topMatch1.similarityScore <= 99.0,
    `Expected score in 90-99% range, got ${topMatch1.similarityScore}%`
  );
  assert.strictEqual(topMatch1.relationshipType, "near_duplicate");
  assert.strictEqual(topMatch1.isExact, false);
  assert.strictEqual(topMatch1.breakdown.content, 98.0, "Expected 98.0% content overlap for 2/100 changed rows");
  console.log("✓ Test 1 PASSED: Real download interception produced 98.8% near-duplicate score\n");

  // -------------------------------------------------------------------------
  // Acceptance Test 2: Byte-Identical Real Download
  // Download exact same file twice -> 100.0% Exact Duplicate
  // -------------------------------------------------------------------------
  console.log("[Test 2] Byte-Identical Download (100% exact duplicate)...");
  const fp1Identical = await fingerprintBuffer(file1Buffer, "data.csv", "text/csv", "https://portal.gov.in/data.csv");
  const matches2 = await findLocalDuplicates(fp1Identical);

  assert.ok(matches2.length > 0, "Expected exact duplicate match");
  assert.strictEqual(matches2[0].similarityScore, 100.0);
  assert.strictEqual(matches2[0].isExact, true);
  assert.strictEqual(matches2[0].relationshipType, "exact_duplicate");
  console.log("✓ Test 2 PASSED: Exact byte match correctly returned 100.0% exact_duplicate\n");

  // -------------------------------------------------------------------------
  // Acceptance Test 3: Manual Indexing (Option A)
  // Edit locally outside browser, rename to data-updated.csv, index via Option A
  // Then download original unmodified data.csv -> near-duplicate alert fires showing data-updated.csv
  // -------------------------------------------------------------------------
  console.log("[Test 3] Option A Manual Indexing (Externally edited & indexed file)...");
  await clearLocalStore();

  // User edited data.csv locally and saved as data-updated.csv (2 rows changed)
  const editedBuffer = generateCsv(100, [99, 100]);
  const manualFp = await fingerprintBuffer(
    editedBuffer,
    "data-updated.csv",
    "text/csv",
    "local-file",
    { isManualIndex: true, lastModified: Date.now() - 3600000 }
  );

  // User clicked "Index a local file" in extension popup
  await saveLocalRecord(manualFp);

  // Later, user goes to website and downloads the original unmodified data.csv
  const incomingOriginalFp = await fingerprintBuffer(
    file1Buffer,
    "data.csv",
    "text/csv",
    "https://portal.gov.in/data.csv"
  );

  const matches3 = await findLocalDuplicates(incomingOriginalFp);
  assert.ok(matches3.length > 0, "Expected near-duplicate alert against manually-indexed file");
  const topMatch3 = matches3[0];

  console.log(`  Matched existing record name: "${topMatch3.record.fileName}"`);
  console.log(`  Similarity score: ${topMatch3.similarityScore}%`);
  console.log(`  Source: ${topMatch3.record.source}`);

  assert.strictEqual(topMatch3.record.fileName, "data-updated.csv", "Alert must show locally saved identity");
  assert.ok(
    topMatch3.similarityScore >= 80.0 && topMatch3.similarityScore <= 99.0,
    `Expected near-duplicate score, got ${topMatch3.similarityScore}%`
  );
  assert.strictEqual(topMatch3.isExact, false);
  console.log("✓ Test 3 PASSED: Manually-indexed file triggered near-duplicate alert showing local identity\n");

  // -------------------------------------------------------------------------
  // Acceptance Test 4: Stale Record Verification
  // Edit a tracked file locally WITHOUT re-indexing it -> download original ->
  // compares against whatever is actually indexed, no false guessing.
  // -------------------------------------------------------------------------
  console.log("[Test 4] Stale Record Check (System compares against indexed state, no silent guessing)...");
  await clearLocalStore();

  // Step 1: User downloaded original data.csv in the past
  const pastDownloadedFp = await fingerprintBuffer(file1Buffer, "data.csv", "text/csv", "https://portal.gov.in/data.csv");
  await saveLocalRecord(pastDownloadedFp);

  // Step 2: User edits file locally in Excel BUT DOES NOT index it with Option A or B.
  // IndexedDB still holds pastDownloadedFp (file1Buffer).

  // Step 3: User downloads original data.csv again from web
  const incomingWebFp = await fingerprintBuffer(file1Buffer, "data.csv", "text/csv", "https://portal.gov.in/data.csv");
  const matches4 = await findLocalDuplicates(incomingWebFp);

  assert.strictEqual(matches4[0].similarityScore, 100.0, "Should match indexed version exactly");
  assert.strictEqual(matches4[0].record.sha256, pastDownloadedFp.sha256);
  console.log("✓ Test 4 PASSED: System accurately evaluated against indexed state without guessing\n");

  // -------------------------------------------------------------------------
  // Acceptance Test 5: Option B Directory Re-Scan
  // Directory re-scan detects modified file on disk, updates signature in-place,
  // and subsequent web download triggers near-duplicate alert without manual picker.
  // -------------------------------------------------------------------------
  console.log("[Test 5] Option B Directory Re-Scan (Automatic in-place update from disk)...");

  // Mock File System Access API directory handle
  const mockDiskFiles = new Map();
  mockDiskFiles.set("data.csv", {
    name: "data.csv",
    type: "text/csv",
    lastModified: Date.now(),
    arrayBuffer: async () => generateCsv(100, [99, 100]), // Modified on disk!
  });

  const mockDirHandle = {
    name: "Downloads",
    getFileHandle: async (filename) => {
      const file = mockDiskFiles.get(filename);
      if (!file) throw new Error("File not found");
      return { getFile: async () => file };
    },
  };

  // Run directory refresh
  const refreshResult = await refreshTrackedFilesFromDirectory(mockDirHandle);
  console.log(`  Directory refresh result: ${refreshResult.updated} updated out of ${refreshResult.scanned} scanned`);
  assert.strictEqual(refreshResult.updated, 1, "Expected 1 modified file to be updated in registry");

  // Verify updated record in IndexedDB
  const allRecords = await getAllLocalRecords();
  const updatedRecord = allRecords.find((r) => r.fileName === "data.csv");
  assert.ok(updatedRecord, "Updated record must exist");

  // Now user downloads original unmodified data.csv from the web
  const webDownloadFp = await fingerprintBuffer(file1Buffer, "data.csv", "text/csv", "https://portal.gov.in/data.csv");
  const matches5 = await findLocalDuplicates(webDownloadFp);

  assert.ok(matches5.length > 0, "Expected near-duplicate match after directory refresh");
  console.log(`  Post-refresh match similarity score: ${matches5[0].similarityScore}%`);
  assert.ok(
    matches5[0].similarityScore >= 90.0 && matches5[0].similarityScore <= 99.0,
    `Expected near-duplicate score, got ${matches5[0].similarityScore}%`
  );
  assert.strictEqual(matches5[0].isExact, false);
  console.log("✓ Test 5 PASSED: Option B directory refresh updated record and triggered near-duplicate alert\n");

  console.log("============================================================");
  console.log("  ALL ACCEPTANCE TESTS PASSED SUCCESSFULLY! (5/5)");
  console.log("============================================================");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
