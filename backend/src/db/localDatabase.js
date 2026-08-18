const crypto = require("crypto");
const bcrypt = require("bcryptjs");

class LocalDatabase {
  constructor() {
    this.users = [];
    this.access_policies = [];
    this.datasets = [];
    this.dataset_versions = [];
    this.version_relationships = [];
    this.downloads = [];
    this.alert_reviews = [];
    this.audit_log = [];

    this.initSeedData();
  }

  initSeedData() {
    const passwordHash = bcrypt.hashSync("password123", 10);
    const adminHash = bcrypt.hashSync("admin123", 10);

    const userAdmin = {
      id: "u-admin-001",
      name: "System Admin",
      email: "admin@ddas.gov.in",
      password_hash: adminHash,
      department: "IT",
      role: "admin",
      created_at: new Date().toISOString(),
    };
    const userRahul = {
      id: "u-rahul-002",
      name: "Rahul Verma",
      email: "rahul@meteorology.gov.in",
      password_hash: passwordHash,
      department: "Meteorology",
      role: "user",
      created_at: new Date().toISOString(),
    };
    const userAditi = {
      id: "u-aditi-003",
      name: "Aditi Sharma",
      email: "aditi@research.gov.in",
      password_hash: passwordHash,
      department: "Research",
      role: "user",
      created_at: new Date().toISOString(),
    };
    const userKavita = {
      id: "u-kavita-004",
      name: "Dr. Kavita Rao",
      email: "kavita@research.gov.in",
      password_hash: passwordHash,
      department: "Research",
      role: "department_admin",
      created_at: new Date().toISOString(),
    };

    this.users.push(userAdmin, userRahul, userAditi, userKavita);

    this.access_policies.push(
      { id: "p1", role: "admin", department: null, classification: "public", action: "view", effect: "allow" },
      { id: "p2", role: "admin", department: null, classification: "internal", action: "view", effect: "allow" },
      { id: "p3", role: "admin", department: null, classification: "restricted", action: "view", effect: "allow" },
      { id: "p4", role: "admin", department: null, classification: "confidential", action: "view", effect: "allow" },
      { id: "p5", role: "user", department: null, classification: "public", action: "view", effect: "allow" },
      { id: "p6", role: "user", department: null, classification: "internal", action: "view", effect: "allow" },
      { id: "p7", role: "user", department: null, classification: "restricted", action: "view", effect: "deny" },
      { id: "p8", role: "user", department: null, classification: "confidential", action: "view", effect: "deny" },
      { id: "p9", role: "department_admin", department: null, classification: "public", action: "view", effect: "allow" },
      { id: "p10", role: "department_admin", department: null, classification: "internal", action: "view", effect: "allow" },
      { id: "p11", role: "department_admin", department: null, classification: "restricted", action: "view", effect: "allow" }
    );

    // Empty initial dataset registry — starts completely fresh
    this.datasets = [];
    this.dataset_versions = [];
    this.version_relationships = [];
    this.alert_reviews = [];

    const genesisPrev = "0".repeat(64);
    const genesisPayload = {
      event_type: "GENESIS",
      actor_id: "u-admin-001",
      resource_type: "system",
      resource_id: "ddas-core",
      details: { message: "DDAS Institute Registry initialized" },
      prev_hash: genesisPrev,
    };
    const genesisHash = crypto
      .createHash("sha256")
      .update(genesisPrev + JSON.stringify(genesisPayload, Object.keys(genesisPayload).sort()))
      .digest("hex");

    this.audit_log.push({
      id: 1,
      ...genesisPayload,
      this_hash: genesisHash,
      created_at: new Date().toISOString(),
    });
  }


  async query(sqlText, params = []) {
    const trimmed = sqlText.trim();
    const upper = trimmed.toUpperCase();

    // 1. Users
    if (upper.includes("FROM USERS")) {
      if (upper.startsWith("SELECT")) {
        if (upper.includes("WHERE EMAIL =")) {
          const email = params[0]?.toLowerCase();
          const match = this.users.filter((u) => u.email.toLowerCase() === email);
          return { rows: match };
        }
        if (upper.includes("WHERE ID =")) {
          const id = params[0];
          const match = this.users.filter((u) => u.id === id);
          return { rows: match };
        }
        return { rows: [...this.users] };
      }
    }

    if (upper.startsWith("INSERT INTO USERS")) {
      const [name, email, passwordHash, department, role] = params;
      const newUser = {
        id: `u-${Date.now()}`,
        name,
        email,
        password_hash: passwordHash,
        department,
        role: role || "user",
        created_at: new Date().toISOString(),
      };
      this.users.push(newUser);
      return { rows: [newUser] };
    }

    // 2. Access policies
    if (upper.includes("FROM ACCESS_POLICIES")) {
      if (upper.startsWith("SELECT") && params.length >= 4) {
        const [role, dept, classification, action] = params;
        const matched = this.access_policies.filter((p) => {
          const roleMatch = p.role === role || p.role === "*";
          const deptMatch = !p.department || p.department === dept;
          const classMatch = p.classification === classification;
          const actionMatch = p.action === action;
          return roleMatch && deptMatch && classMatch && actionMatch;
        });
        matched.sort((a, b) => (b.effect === "deny" ? 1 : -1));
        return { rows: matched };
      }
      return { rows: [...this.access_policies] };
    }

    // 3. Version relationships (evaluated BEFORE generic dataset_versions to prevent join shadowing)
    if (upper.includes("FROM VERSION_RELATIONSHIPS")) {
      if (upper.includes("GROUP BY D.TITLE")) {
        const counts = {};
        for (const vr of this.version_relationships) {
          const v = this.dataset_versions.find((dv) => dv.id === vr.version_a_id);
          if (v) {
            const ds = this.datasets.find((d) => d.id === v.dataset_id);
            if (ds) {
              counts[ds.title] = (counts[ds.title] || 0) + 1;
            }
          }
        }
        const rows = Object.entries(counts).map(([title, alert_count]) => ({ title, alert_count }));
        rows.sort((a, b) => b.alert_count - a.alert_count);
        return { rows: rows.slice(0, 5) };
      }

      const rows = this.version_relationships.map((vr) => {
        const dva = this.dataset_versions.find((dv) => dv.id === vr.version_a_id) || {};
        const dvb = this.dataset_versions.find((dv) => dv.id === vr.version_b_id) || {};
        const da = this.datasets.find((d) => d.id === dva.dataset_id) || {};
        const db = this.datasets.find((d) => d.id === dvb.dataset_id) || {};
        const ar = this.alert_reviews.find((r) => r.relationship_id === vr.id) || {};
        const assignee = this.users.find((u) => u.id === ar.assigned_to) || {};

        return {
          relationship_id: vr.id,
          id: vr.id,
          relationship_type: vr.relationship_type,
          similarity_score: vr.similarity_score,
          score_breakdown: vr.score_breakdown,
          content_diff: vr.content_diff,
          created_at: vr.created_at,
          detected_at: vr.created_at,
          dataset_id: da.id || dva.dataset_id,
          title: da.title || dva.original_filename || "Dataset",
          owner_department: da.owner_department || "General",
          classification: da.classification || "internal",
          status: ar.status || "new",
          assigned_to: ar.assigned_to || null,
          assignee_name: assignee.name || null,
          status_updated_at: ar.updated_at || vr.created_at,
          // Pair details for alert investigation
          version_a_id: dva.id,
          a_filename: dva.original_filename,
          a_uploaded_at: dva.uploaded_at,
          a_dataset_id: da.id,
          a_title: da.title,
          a_department: da.owner_department,
          a_classification: da.classification,
          version_b_id: dvb.id,
          b_filename: dvb.original_filename,
          b_uploaded_at: dvb.uploaded_at,
          b_dataset_id: db.id,
          b_title: db.title,
          b_department: db.owner_department,
          b_classification: db.classification,
        };
      });

      if (upper.includes("COUNT(*)")) {
        return { rows: [{ count: String(rows.length), total: String(rows.length) }] };
      }

      if (upper.includes("WHERE VR.ID =") || upper.includes("WHERE ID =")) {
        const id = params[0];
        const match = rows.find((r) => r.id === id || r.relationship_id === id);
        return { rows: match ? [match] : [] };
      }

      if (upper.includes("WHERE DV1.DATASET_ID =") || upper.includes("WHERE DV2.DATASET_ID =") || upper.includes("WHERE DV.DATASET_ID =") || upper.includes("WHERE DV2.DATASET_ID =")) {
        const dsId = params[0];
        const filtered = rows.filter((r) => r.a_dataset_id === dsId || r.b_dataset_id === dsId || r.dataset_id === dsId);
        return { rows: filtered };
      }

      return { rows };
    }

    if (upper.startsWith("INSERT INTO VERSION_RELATIONSHIPS")) {
      const [version_a_id, version_b_id, relationship_type, similarity_score, score_breakdown, content_diff] = params;
      const newRel = {
        id: `vr-${Date.now()}`,
        version_a_id,
        version_b_id,
        relationship_type,
        similarity_score,
        score_breakdown,
        content_diff,
        created_at: new Date().toISOString(),
      };
      this.version_relationships.push(newRel);
      return { rows: [newRel] };
    }

    // 4. Alert reviews
    if (upper.includes("FROM ALERT_REVIEWS")) {
      const rows = this.alert_reviews.map((ar) => {
        const u = this.users.find((user) => user.id === ar.assigned_to) || {};
        return { ...ar, assignee_name: u.name || null };
      });
      if (upper.includes("WHERE RELATIONSHIP_ID =")) {
        const relId = params[0];
        return { rows: rows.filter((r) => r.relationship_id === relId) };
      }
      return { rows };
    }

    if (upper.startsWith("INSERT INTO ALERT_REVIEWS") || upper.startsWith("UPDATE ALERT_REVIEWS")) {
      const relId = params[0];
      let existing = this.alert_reviews.find((r) => r.relationship_id === relId);
      if (!existing) {
        existing = {
          id: `ar-${Date.now()}`,
          relationship_id: relId,
          status: params[1] || "investigating",
          assigned_to: params[2] || null,
          notes: params[3] || "",
          updated_at: new Date().toISOString(),
        };
        this.alert_reviews.push(existing);
      } else {
        existing.status = params[1] || existing.status;
        existing.assigned_to = params[2] || existing.assigned_to;
        existing.notes = params[3] || existing.notes;
        existing.updated_at = new Date().toISOString();
      }
      return { rows: [existing] };
    }

    // 5. Audit log
    if (upper.startsWith("INSERT INTO AUDIT_LOG")) {
      const [event_type, actor_id, resource_type, resource_id, details, prev_hash, this_hash] = params;
      const newLog = {
        id: this.audit_log.length + 1,
        event_type,
        actor_id,
        resource_type,
        resource_id,
        details,
        prev_hash: prev_hash || "0".repeat(64),
        this_hash: this_hash || crypto.createHash("sha256").update(JSON.stringify(details || {})).digest("hex"),
        created_at: new Date().toISOString(),
      };
      this.audit_log.push(newLog);
      return { rows: [newLog] };
    }

    if (upper.includes("FROM AUDIT_LOG")) {
      const rows = this.audit_log.map((al) => {
        const actor = this.users.find((u) => u.id === al.actor_id) || {};
        return { ...al, actor_name: actor.name || "System" };
      });
      if (upper.includes("ORDER BY ID ASC") || upper.includes("ORDER BY AL.ID ASC")) {
        return { rows: [...rows] };
      }
      return { rows: [...rows].reverse().slice(0, 50) };
    }


    // 6. Downloads
    if (upper.startsWith("SELECT") && upper.includes("FROM DOWNLOADS")) {
      let filtered = [...this.downloads];
      if (upper.includes("WHERE DATASET_VERSION_ID =")) {
        const vid = params[0];
        filtered = filtered.filter((d) => d.dataset_version_id === vid);
      }
      if (upper.includes("WHERE ACTION_TAKEN = 'USED_EXISTING'")) {
        filtered = filtered.filter((d) => d.action_taken === "used_existing");
      }
      if (upper.includes("SUM(BYTES_SAVED)")) {
        const total = filtered.reduce((acc, d) => acc + (Number(d.bytes_saved) || 0), 0);
        return { rows: [{ total: String(total), count: filtered.length }] };
      }
      if (upper.includes("COUNT(*)")) {
        return { rows: [{ total: String(filtered.length), count: filtered.length }] };
      }
      return { rows: filtered };
    }

    if (upper.startsWith("INSERT INTO DOWNLOADS")) {
      let d;
      if (params.length >= 8) {
        const [dataset_version_id, user_id, was_alerted, action_taken, bytes_saved, username, department, download_location] = params;
        d = {
          id: `dl-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          dataset_version_id,
          user_id,
          was_alerted: Boolean(was_alerted),
          action_taken,
          bytes_saved: bytes_saved || 0,
          username: username || "user",
          department: department || "General",
          download_location: download_location || "Registry Storage",
          downloaded_at: new Date().toISOString(),
        };
      } else {
        const [dataset_version_id, user_id, was_alerted, action_taken, bytes_saved] = params;
        const u = this.users.find((user) => user.id === user_id);
        const v = this.dataset_versions.find((ver) => ver.id === dataset_version_id);
        const ds = v ? this.datasets.find((data) => data.id === v.dataset_id) : null;
        d = {
          id: `dl-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          dataset_version_id,
          user_id,
          was_alerted: Boolean(was_alerted),
          action_taken,
          bytes_saved: bytes_saved || 0,
          username: u?.username || u?.name || "user",
          department: u?.department || ds?.owner_department || "General",
          download_location: `${ds?.owner_department || u?.department || "Institute"} Department Registry`,

          downloaded_at: new Date().toISOString(),
        };
      }
      this.downloads.push(d);
      return { rows: [d] };
    }


    // 7. Datasets & Versions Joined
    if (upper.startsWith("SELECT") && upper.includes("DATASET_VERSIONS") && upper.includes("DATASETS")) {
      let rows = this.dataset_versions.map((dv) => {
        const d = this.datasets.find((ds) => ds.id === dv.dataset_id) || {};
        const u = this.users.find((user) => user.id === dv.uploaded_by) || {};
        return {
          ...dv,
          ...d,
          id: dv.id,
          dataset_id: dv.dataset_id,
          uploaded_by_username: u.username || u.name || dv.uploaded_by || "Institute User",
          uploaded_by_name: u.name || u.username || "Institute User",
        };
      });


      if (upper.includes("DV.SHA256 =")) {
        const hash = params[0];
        rows = rows.filter((r) => r.sha256 === hash);
      } else if (upper.includes("DV.ID =")) {
        const id = params[0];
        rows = rows.filter((r) => r.id === id);
      } else if (upper.includes("DV.SIZE_BYTES BETWEEN")) {
        const min = params[0];
        const max = params[1];
        rows = rows.filter((r) => r.size_bytes >= min && r.size_bytes <= max);
      }
      return { rows };
    }

    if (upper.startsWith("SELECT") && upper.includes("FROM DATASET_VERSIONS")) {
      if (upper.includes("WHERE SHA256 =")) {
        const hash = params[0];
        return { rows: this.dataset_versions.filter((dv) => dv.sha256 === hash) };
      }
      if (upper.includes("WHERE ID =")) {
        const id = params[0];
        return { rows: this.dataset_versions.filter((dv) => dv.id === id) };
      }
      if (upper.includes("WHERE DATASET_ID =")) {
        const datasetId = params[0];
        return { rows: this.dataset_versions.filter((dv) => dv.dataset_id === datasetId) };
      }
      return { rows: [...this.dataset_versions] };
    }

    if (upper.startsWith("SELECT") && upper.includes("FROM DATASETS")) {
      let rows = this.datasets.map((ds) => {
        const latestVersion = this.dataset_versions.filter((dv) => dv.dataset_id === ds.id).pop();
        return {
          ...ds,
          dataset_id: ds.id,
          period_start: ds.period_start || latestVersion?.period_start || null,
          period_end: ds.period_end || latestVersion?.period_end || null,
          spatial_region_name: ds.spatial_region_name || latestVersion?.spatial_region_name || null,
        };
      });

      if (upper.includes("WHERE ID =") || upper.includes("WHERE D.ID =")) {
        const id = params[0];
        const ds = rows.find((d) => d.id === id);
        return { rows: ds ? [ds] : [] };
      }

      if (upper.includes("WHERE TITLE =") || upper.includes("WHERE D.TITLE =")) {
        const title = params[0];
        const ds = rows.filter((d) => d.title === title);
        return { rows: ds };
      }

      if (params.length > 0) {
        for (const p of params) {
          if (typeof p === "string" && p.startsWith("%") && p.endsWith("%")) {
            const q = p.slice(1, -1).toLowerCase();
            rows = rows.filter(
              (d) =>
                (d.title && d.title.toLowerCase().includes(q)) ||
                (d.description && d.description.toLowerCase().includes(q)) ||
                (d.spatial_region_name && d.spatial_region_name.toLowerCase().includes(q))
            );
          } else if (typeof p === "string") {
            rows = rows.filter((d) => d.domain === p || d.owner_department === p);
          }
        }
      }

      return { rows };
    }

    if (upper.startsWith("INSERT INTO DATASETS")) {
      const [title, description, domain, owner_department, classification] = params;
      const newDataset = {
        id: `ds-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        title,
        description,
        domain: domain || "General",
        owner_department: owner_department || "General",
        classification: classification || "internal",
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.datasets.push(newDataset);
      return { rows: [newDataset] };
    }

    if (upper.startsWith("INSERT INTO DATASET_VERSIONS")) {
      let newVersion;
      if (params.length >= 10) {
        const [
          id,
          dataset_id,
          version_num,
          original_filename,
          format,
          size_bytes,
          sha256,
          storage_key,
          period_start,
          period_end,
          spatial_min_lat,
          spatial_max_lat,
          spatial_min_lng,
          spatial_max_lng,
          spatial_region_name,
          uploaded_by,
        ] = params;
        newVersion = {
          id: id || `dv-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          dataset_id,
          version_num: version_num || 1,
          original_filename,
          format: format || "csv",
          size_bytes: Number(size_bytes) || 0,
          sha256,
          storage_key: storage_key || `key-${sha256}`,
          period_start: period_start || null,
          period_end: period_end || null,
          spatial_min_lat: spatial_min_lat ?? null,
          spatial_max_lat: spatial_max_lat ?? null,
          spatial_min_lng: spatial_min_lng ?? null,
          spatial_max_lng: spatial_max_lng ?? null,
          spatial_region_name: spatial_region_name || null,
          schema_fingerprint: null,
          uploaded_by: uploaded_by || "system",
          uploaded_at: new Date().toISOString(),
        };
      } else {
        const [
          dataset_id,
          version_num,
          original_filename,
          format,
          size_bytes,
          sha256,
          storage_key,
          uploaded_by,
          period_start,
          period_end,
          spatial_region_name,
        ] = params;
        newVersion = {
          id: `dv-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          dataset_id,
          version_num: version_num || 1,
          original_filename,
          format: format || "csv",
          size_bytes: Number(size_bytes) || 0,
          sha256,
          storage_key: storage_key || `key-${sha256}`,
          period_start: period_start || null,
          period_end: period_end || null,
          spatial_min_lat: null,
          spatial_max_lat: null,
          spatial_min_lng: null,
          spatial_max_lng: null,
          spatial_region_name: spatial_region_name || null,
          schema_fingerprint: null,
          uploaded_by: uploaded_by || "system",
          uploaded_at: new Date().toISOString(),
        };
      }
      this.dataset_versions.push(newVersion);
      return { rows: [newVersion] };
    }

    if (upper.startsWith("UPDATE DATASET_VERSIONS")) {
      if (upper.includes("SCHEMA_FINGERPRINT =")) {
        const [schema_fingerprint, id] = params;
        const v = this.dataset_versions.find((dv) => dv.id === id);
        if (v) v.schema_fingerprint = schema_fingerprint;
        return { rows: [v] };
      }
    }

    return { rows: [] };
  }

  async end() {}
}

module.exports = new LocalDatabase();
