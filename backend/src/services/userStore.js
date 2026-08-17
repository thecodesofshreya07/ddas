const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const DATA_DIR = path.resolve(__dirname, "../../data");
const USERS_FILE = path.join(DATA_DIR, "users.json");



function ensureDirectoryExists() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function initDefaultUsers() {
  ensureDirectoryExists();
  if (!fs.existsSync(USERS_FILE)) {
    const passwordHash = bcrypt.hashSync("password123", 10);
    const adminHash = bcrypt.hashSync("admin123", 10);

    const defaultUsers = [
      {
        id: "u-admin-001",
        username: "admin",
        email: "admin@ddas.gov.in",
        passwordHash: adminHash,
        department: "IT",
        role: "admin",
        createdAt: new Date().toISOString(),
      },
      {
        id: "u-rahul-002",
        username: "rahul",
        email: "rahul@meteorology.gov.in",
        passwordHash: passwordHash,
        department: "Meteorology",
        role: "user",
        createdAt: new Date().toISOString(),
      },
      {
        id: "u-aditi-003",
        username: "aditi",
        email: "aditi@research.gov.in",
        passwordHash: passwordHash,
        department: "Research",
        role: "user",
        createdAt: new Date().toISOString(),
      },
      {
        id: "u-kavita-004",
        username: "kavita",
        email: "kavita@research.gov.in",
        passwordHash: passwordHash,
        department: "Research",
        role: "department_admin",
        createdAt: new Date().toISOString(),
      },
    ];

    writeUsersSafely(defaultUsers);
  }
}

function readUsers() {
  initDefaultUsers();
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("[userStore] Error reading users.json:", err.message);
    return [];
  }
}

function writeUsersSafely(users) {
  ensureDirectoryExists();
  const tempPath = `${USERS_FILE}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 7)}`;
  const jsonContent = JSON.stringify(users, null, 2);
  try {
    fs.writeFileSync(tempPath, jsonContent, "utf-8");
    try {
      if (fs.existsSync(USERS_FILE)) {
        fs.copyFileSync(tempPath, USERS_FILE);
        try { fs.unlinkSync(tempPath); } catch {}
      } else {
        fs.renameSync(tempPath, USERS_FILE);
      }
    } catch {
      fs.writeFileSync(USERS_FILE, jsonContent, "utf-8");
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    }
  } catch {
    fs.writeFileSync(USERS_FILE, jsonContent, "utf-8");
  }
}


function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

async function findUserByUsernameOrEmail(identifier) {
  if (!identifier) return null;
  const lower = String(identifier).trim().toLowerCase();
  const users = readUsers();
  return users.find(
    (u) =>
      (u.username && u.username.toLowerCase() === lower) ||
      (u.email && u.email.toLowerCase() === lower)
  ) || null;
}

async function createUser({ username, password, department, role, email }) {
  if (!username || !password || !department) {
    throw new Error("username, password, and department are required");
  }

  const cleanUsername = String(username).trim();
  if (cleanUsername.length < 3) {
    throw new Error("Username must be at least 3 characters");
  }

  if (String(password).length < 6) {
    throw new Error("Password must be at least 6 characters");
  }

  const users = readUsers();
  const lowerName = cleanUsername.toLowerCase();
  const existing = users.find(
    (u) =>
      u.username.toLowerCase() === lowerName ||
      (email && u.email && u.email.toLowerCase() === String(email).trim().toLowerCase())
  );

  if (existing) {
    throw new Error("Username or email already exists");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const newUser = {
    id: `u-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    username: cleanUsername,
    email: email ? String(email).trim().toLowerCase() : `${cleanUsername}@ddas.gov.in`,
    passwordHash,
    department: String(department).trim(),
    role: role || "user",
    createdAt: new Date().toISOString(),
  };

  users.push(newUser);
  writeUsersSafely(users);

  return sanitizeUser(newUser);
}

async function verifyPassword(user, plainPassword) {
  if (!user || !user.passwordHash || !plainPassword) return false;
  return await bcrypt.compare(plainPassword, user.passwordHash);
}

module.exports = {
  readUsers,
  findUserByUsernameOrEmail,
  createUser,
  verifyPassword,
  sanitizeUser,
};
