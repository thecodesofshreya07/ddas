const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "ddas-insecure-dev-secret-change-in-prod";

/**
 * Verifies the JWT and attaches { id, email, role, department } to req.user.
 * Every route that touches data should sit behind this — there is no
 * "trusted internal network" concept in DDAS (Zero Trust principle: never
 * trust by network location, always verify identity per-request).
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing bearer token" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}


/**
 * Restricts a route to specific roles, e.g. requireRole("admin").
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient role" });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
