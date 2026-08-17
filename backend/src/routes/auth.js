const express = require("express");
const jwt = require("jsonwebtoken");
const { recordEvent } = require("../services/auditLog");
const userStore = require("../services/userStore");
const pool = require("../db/pool");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "ddas-insecure-dev-secret-change-in-prod";

async function handleSignup(req, res) {
  const { username, name, email, password, department, role } = req.body;
  const targetUsername = username || name || (email ? email.split("@")[0] : "");

  if (!targetUsername || !password || !department) {
    return res.status(400).json({ error: "username, password, and department are required" });
  }

  try {
    const newUser = await userStore.createUser({
      username: targetUsername,
      email: email || `${targetUsername}@ddas.gov.in`,
      password,
      department,
      role: role || "user",
    });

    // Also record in SQL pool for relations if needed
    try {
      await pool.query(
        `INSERT INTO users (name, email, password_hash, department, role)
         VALUES ($1, $2, $3, $4, $5)`,
        [newUser.username, newUser.email, newUser.passwordHash || "hash", newUser.department, newUser.role]
      );
    } catch {}

    const token = jwt.sign(
      {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role,
        department: newUser.department,
      },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );

    await recordEvent({
      event_type: "USER_REGISTERED",
      actor_id: newUser.id,
      resource_type: "user",
      resource_id: newUser.id,
      details: { username: newUser.username, department: newUser.department },
    });

    res.status(201).json({
      token,
      user: {
        id: newUser.id,
        username: newUser.username,
        name: newUser.username,
        email: newUser.email,
        department: newUser.department,
        role: newUser.role,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

router.post("/signup", handleSignup);
router.post("/register", handleSignup);

router.post("/login", async (req, res) => {
  const { email, username, password } = req.body;
  const identifier = username || email;

  if (!identifier || !password) {
    return res.status(400).json({ error: "username/email and password are required" });
  }

  const user = await userStore.findUserByUsernameOrEmail(identifier);
  const valid = user ? await userStore.verifyPassword(user, password) : false;

  if (!user || !valid) {
    await recordEvent({
      event_type: "LOGIN_FAILED",
      details: { identifier },
    });
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      department: user.department,
    },
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
    user: {
      id: user.id,
      username: user.username,
      name: user.username || user.name,
      email: user.email,
      role: user.role,
      department: user.department,
    },
  });
});

module.exports = router;
