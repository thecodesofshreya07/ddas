require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const authRoutes = require("./routes/auth");
const uploadRoutes = require("./routes/upload");
const datasetRoutes = require("./routes/datasets");
const alertRoutes = require("./routes/alerts");
const { searchLimiter, authLimiter } = require("./middleware/rateLimit");
const { ensureBucket } = require("./services/storage");
const { ensureIndex } = require("./services/search");

const app = express();

app.use(helmet());
// Browser extensions call this API from a chrome-extension:// origin, not
// a normal web origin — cors() with no options reflects any origin, which
// covers both the web frontend and the extension without needing to
// hardcode the extension's generated ID.
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok", ts: new Date().toISOString() }));

// Rate limits applied per-route-group, not globally, so heavy-but-legitimate
// admin dashboard/status polling doesn't compete with the same budget as
// uploads or auth attempts. Upload's own POST route carries its own tight
// limiter (see routes/upload.js) — the status-polling route has a separate,
// much more generous one.
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/datasets/search", searchLimiter);
app.use("/api/datasets", datasetRoutes);
app.use("/api/alerts", alertRoutes);

app.use((err, req, res, next) => {
  console.error("[error]", err);
  if (err.message?.startsWith("Unsupported file type")) {
    return res.status(415).json({ error: err.message });
  }
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "File exceeds the maximum allowed size" });
  }
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 4000;

(async () => {
  try {
    await ensureBucket();
    await ensureIndex();
    app.listen(PORT, () => console.log(`[server] DDAS API listening on :${PORT}`));
  } catch (err) {
    console.error("[server] failed to start:", err);
    process.exit(1);
  }
})();
