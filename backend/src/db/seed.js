require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("./pool");

/**
 * Creates demo users across a few departments so the RBAC/ABAC demo has
 * something real to show (a "user" who gets denied on a restricted
 * dataset, a "department_admin" who can see it, an "admin" who sees all).
 * Run with: npm run seed
 */
async function seed() {
  const users = [
    { name: "Aditi Sharma", email: "aditi@research.gov.in", password: "password123", department: "Research", role: "user" },
    { name: "Rahul Verma", email: "rahul@meteorology.gov.in", password: "password123", department: "Meteorology", role: "user" },
    { name: "Dr. Kavita Rao", email: "kavita@research.gov.in", password: "password123", department: "Research", role: "department_admin" },
    { name: "System Admin", email: "admin@ddas.gov.in", password: "admin123", department: "IT", role: "admin" },
  ];

  for (const u of users) {
    const exists = await pool.query("SELECT id FROM users WHERE email = $1", [u.email]);
    if (exists.rows.length > 0) {
      console.log(`[seed] ${u.email} already exists, skipping`);
      continue;
    }
    const hash = await bcrypt.hash(u.password, 12);
    await pool.query(
      `INSERT INTO users (name, email, password_hash, department, role) VALUES ($1,$2,$3,$4,$5)`,
      [u.name, u.email, hash, u.department, u.role]
    );
    console.log(`[seed] created ${u.role} ${u.email} / password: ${u.password}`);
  }

  console.log("[seed] done. Suggested demo flow:");
  console.log("  1. Log in as rahul@meteorology.gov.in");
  console.log("  2. Upload 'Mumbai_Rainfall_2024.csv' -> registers as new dataset");
  console.log("  3. Log in as aditi@research.gov.in");
  console.log("  4. Upload 'Mumbai_Rainfall_2024_Final.csv' (same content, different name/rows-order)");
  console.log("     -> similarity engine should flag it as exact_duplicate or new_version");
  console.log("  5. Try downloading -> see the pre-download alert screen");

  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
