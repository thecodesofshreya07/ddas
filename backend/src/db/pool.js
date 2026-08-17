const { Pool } = require("pg");

// Single shared connection pool. Postgres is the authoritative source of
// truth for the whole system — Elasticsearch and Redis/BullMQ are
// derived/ephemeral and can always be rebuilt from this database.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("[postgres] unexpected error on idle client", err);
});

module.exports = pool;
