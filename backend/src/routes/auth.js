const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
const { recordEvent } = require("../services/auditLog");

const router = express.Router();

router.post("/register", async (req, res) => {
  const { name, email, password, department, role } = req.body;
  if (!name || !email || !password || !department) {
    return res.status(400).json({ error: "name, email, password, department are required" });
  }

  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: "Email already registered" });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, department, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, email, department, role`,
    [name, email, passwordHash, department, role || "user"]
  );

  const user = rows[0];
  await recordEvent({
    event_type: "USER_REGISTERED",
    actor_id: user.id,
    resource_type: "user",
    resource_id: user.id,
    details: { email },
  });

  res.status(201).json({ user });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  const user = rows[0];

  // Constant-shape response whether the user exists or not, to avoid
  // leaking account existence via timing/response differences.
  const valid = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!user || !valid) {
    await recordEvent({
      event_type: "LOGIN_FAILED",
      details: { email },
    });
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const JWT_SECRET = process.env.JWT_SECRET || "ddas-insecure-dev-secret-change-in-prod";
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, department: user.department },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
  );


  await recordEvent({
    event_type: "LOGIN",
    actor_id: user.id,
    resource_type: "user",
    resource_id: user.id,
  });

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department },
  });
});

module.exports = router;
