const crypto = require("crypto");
const { filenameSimilarity, scoreCandidate, classifyRelationship } = require("./src/services/duplicateEngine");
const { fingerprintCsv } = require("./src/services/structuralFingerprint");

async function runTests() {
  console.log("==================================================================");
  console.log("  DDAS SCORING & LEVENSHTEIN VALIDATION SUITE");
  console.log("==================================================================");

  // --- Test 1: Levenshtein Filename Similarity ---
  console.log("\n--- TEST 1: Levenshtein Filename Similarity ---");
  const nameA = "access-code-password-recovery-code.csv";
  const nameSame = "access-code-password-recovery-code.csv";
  const nameV2 = "access-code-password-recovery-code-v2.csv";
  const nameRenamed = "access-code-2024.csv";
  const nameUnrelated = "weather_data_delhi.csv";

  const simSame = filenameSimilarity(nameA, nameSame);
  const simV2 = filenameSimilarity(nameA, nameV2);
  const simRenamed = filenameSimilarity(nameA, nameRenamed);
  const simUnrelated = filenameSimilarity(nameA, nameUnrelated);

  console.log(`- Exact same name: '${nameA}' vs '${nameSame}' => ${simSame}%`);
  console.log(`- Small rename (-v2): '${nameA}' vs '${nameV2}' => ${simV2}%`);
  console.log(`- Medium rename: '${nameA}' vs '${nameRenamed}' => ${simRenamed}%`);
  console.log(`- Unrelated name: '${nameA}' vs '${nameUnrelated}' => ${simUnrelated}%`);

  if (simSame === 100.0 && simV2 < 100.0 && simRenamed < simV2 && simUnrelated < simRenamed) {
    console.log(">>> PASS: Filename similarity produces real Levenshtein gradient.");
  } else {
    console.error(">>> FAIL: Filename similarity did not produce expected gradient!");
    process.exit(1);
  }

  // --- Test 2: Row Edit Containment Scoring ---
  console.log("\n--- TEST 2: Row Edit Containment Scoring ---");
  let csvBase = "id,name,role,department\n";
  for (let i = 1; i <= 100; i++) {
    csvBase += `${i},User_${i},Engineer,Engineering\n`;
  }

  // Modify 2 rows out of 100
  let csvModified2 = "id,name,role,department\n";
  for (let i = 1; i <= 100; i++) {
    if (i === 10 || i === 20) {
      csvModified2 += `${i},User_${i}_MODIFIED,Lead,Management\n`;
    } else {
      csvModified2 += `${i},User_${i},Engineer,Engineering\n`;
    }
  }

  const shaBase = crypto.createHash("sha256").update(csvBase).digest("hex");
  const shaMod2 = crypto.createHash("sha256").update(csvModified2).digest("hex");

  const fpBase = await fingerprintCsv(Buffer.from(csvBase));
  const fpMod2 = await fingerprintCsv(Buffer.from(csvModified2));

  const candidate = {
    sha256: shaBase,
    original_filename: "users.csv",
    title: "users.csv",
    size_bytes: Buffer.byteLength(csvBase),
    schema_fingerprint: fpBase,
    contentSignature: fpBase.contentSignature,
  };

  const newVersion = {
    sha256: shaMod2,
    original_filename: "users.csv",
    title: "users.csv",
    size_bytes: Buffer.byteLength(csvModified2),
    schema_fingerprint: fpMod2,
    contentSignature: fpMod2.contentSignature,
  };

  const result = scoreCandidate(newVersion, candidate);
  console.log(`Base SHA: ${shaBase}`);
  console.log(`Mod2 SHA: ${shaMod2} (different bytes)`);
  console.log(`Total Score: ${result.totalScore}%`);
  console.log(`Breakdown: Content = ${result.breakdown.content}%, Schema = ${result.breakdown.schema}%, Metadata = ${result.breakdown.metadata}%`);
  console.log(`Relationship: ${classifyRelationship(newVersion, candidate, result.totalScore, result.isExact)}`);

  if (result.breakdown.content === 98.0 && result.totalScore > 90.0 && result.totalScore < 100.0) {
    console.log(">>> PASS: 2/100 row edit yields exact 98.0% content score and non-binary total score.");
  } else {
    console.error(">>> FAIL: Content score was not 98.0%!");
    process.exit(1);
  }

  // --- Test 3: Byte Match with Renamed File ---
  console.log("\n--- TEST 3: Byte Match with Renamed File ---");
  const exactMatchCand = {
    sha256: shaBase,
    original_filename: "dataset_original.csv",
    title: "dataset_original.csv",
    size_bytes: Buffer.byteLength(csvBase),
    schema_fingerprint: fpBase,
    contentSignature: fpBase.contentSignature,
  };

  const exactMatchNew = {
    sha256: shaBase,
    original_filename: "dataset_renamed.csv",
    title: "dataset_renamed.csv",
    size_bytes: Buffer.byteLength(csvBase),
    schema_fingerprint: fpBase,
    contentSignature: fpBase.contentSignature,
  };

  const exactResult = scoreCandidate(exactMatchNew, exactMatchCand);
  console.log(`Exact byte match total score: ${exactResult.totalScore}%`);
  console.log(`Exact byte match breakdown metadata: ${exactResult.breakdown.metadata}%`);
  if (exactResult.totalScore === 100.0 && exactResult.breakdown.metadata < 100.0) {
    console.log(">>> PASS: Exact byte match is 100% total, but metadata breakdown accurately reflects renamed file.");
  } else {
    console.error(">>> FAIL: Exact match metadata breakdown was hardcoded or incorrect!");
    process.exit(1);
  }

  console.log("\n==================================================================");
  console.log("  ALL TESTS PASSED SUCCESSFULLY!");
  console.log("==================================================================");
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
