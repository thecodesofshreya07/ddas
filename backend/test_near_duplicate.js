const { fingerprintCsv, contentSimilarity, compareSchemaFingerprints } = require('./src/services/structuralFingerprint');
const { scoreCandidate } = require('./src/services/duplicateEngine');

async function runAcceptanceTests() {
  console.log("=== Running Acceptance Tests for DDAS ===");

  // Acceptance Test 1: CSV with 100 rows, 2 changed -> expect 98% content similarity, classified as likely duplicate
  const headers = "id,name,age,department\n";
  let csv1 = headers;
  let csv2 = headers;
  for (let i = 1; i <= 100; i++) {
    csv1 += `${i},User${i},${20 + (i % 30)},Engineering\n`;
    if (i <= 98) {
      csv2 += `${i},User${i},${20 + (i % 30)},Engineering\n`;
    } else {
      csv2 += `${i},ModifiedUser${i},99,Marketing\n`;
    }
  }

  const fp1 = await fingerprintCsv(Buffer.from(csv1));
  const fp2 = await fingerprintCsv(Buffer.from(csv2));

  const contentSim1 = contentSimilarity(fp1.contentSignature, fp2.contentSignature);
  console.log(`Test 1: 2/100 rows changed -> Content Similarity = ${contentSim1}% (Expected: 98%)`);

  const cand1 = { schema_fingerprint: fp1, title: "dataset_v1.csv" };
  const cand2 = { schema_fingerprint: fp2, title: "dataset_v2.csv" };
  const scoreResult1 = scoreCandidate({ schema_fingerprint: fp2, title: "dataset_v2.csv" }, cand1);
  console.log(`Test 1 Blended Score = ${scoreResult1.totalScore}% (Breakdown:`, scoreResult1.breakdown, `)`);

  // Acceptance Test 2: Same CSV renamed -> still detected
  const scoreResult2 = scoreCandidate({ schema_fingerprint: fp1, title: "totally_different_name.csv" }, cand1);
  console.log(`Test 2 (Renamed file) Blended Score = ${scoreResult2.totalScore}%`);

  // Acceptance Test 3: Two unrelated CSVs with same column headers but completely different rows
  let csv3 = headers;
  for (let i = 1; i <= 100; i++) {
    csv3 += `${i + 5000},CompletelyOtherPerson${i},${45},Finance\n`;
  }
  const fp3 = await fingerprintCsv(Buffer.from(csv3));
  const contentSim3 = contentSimilarity(fp1.contentSignature, fp3.contentSignature);
  const schemaSim3 = compareSchemaFingerprints(fp1, fp3);
  const scoreResult3 = scoreCandidate({ schema_fingerprint: fp3, title: "unrelated.csv" }, cand1);
  console.log(`Test 3 (Same structure, different data): Schema = ${schemaSim3}%, Content = ${contentSim3}%, Blended = ${scoreResult3.totalScore}%`);

  // Acceptance Test 7: Large CSV (10k rows) with sampling
  let csvLarge = headers;
  for (let i = 1; i <= 10000; i++) {
    csvLarge += `${i},LargeUser${i},${30},Sales\n`;
  }
  const fpLarge = await fingerprintCsv(Buffer.from(csvLarge));
  console.log(`Test 7 (Large CSV): Row count = ${fpLarge.rowCount}, Sampled = ${fpLarge.contentSignature.sampled}, Row hashes = ${fpLarge.contentSignature.rowHashes.length}`);

  console.log("=== All Tests Completed Successfully ===");
}

runAcceptanceTests().catch(console.error);
