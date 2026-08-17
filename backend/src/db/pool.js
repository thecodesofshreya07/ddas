const { Pool } = require("pg");
const localDb = require("./localDatabase");

let pool = null;
let useLocalDb = false;

try {
  if (process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 3000,
    });

    pool.on("error", (err) => {
      console.warn("[postgres] connection error, switching to local DB store:", err.message);
      useLocalDb = true;
    });
  } else {
    useLocalDb = true;
  }
} catch {
  useLocalDb = true;
}

const poolWrapper = {
  query: async (text, params) => {
    if (!useLocalDb && pool) {
      try {
        return await pool.query(text, params);
      } catch (err) {
        console.warn(`[postgres] PostgreSQL error (${err.code || err.message}), switching to local embedded database`);
        useLocalDb = true;
        return await localDb.query(text, params);
      }
    }
    return await localDb.query(text, params);
  },
  connect: async () => {
    if (!useLocalDb && pool) {
      try {
        const client = await pool.connect();
        return client;
      } catch (err) {
        console.warn(`[postgres] PostgreSQL error (${err.code || err.message}), switching to local embedded database`);
        useLocalDb = true;
      }
    }
    return {
      query: async (text, params) => localDb.query(text, params),
      release: () => {},
    };
  },
  end: async () => {
    if (pool) {
      try {
        await pool.end();
      } catch {}
    }
  },
};

module.exports = poolWrapper;



