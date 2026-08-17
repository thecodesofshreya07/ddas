const { Client } = require("@elastic/elasticsearch");

let client = null;
let useLocalSearch = false;

try {
  if (process.env.ELASTICSEARCH_URL) {
    client = new Client({
      node: process.env.ELASTICSEARCH_URL,
      maxRetries: 0,
      requestTimeout: 800,
      sniffOnStart: false,
    });
  }
} catch {
  useLocalSearch = true;
}

const INDEX = process.env.ELASTICSEARCH_INDEX || "datasets";


async function ensureIndex() {
  if (!client) {
    useLocalSearch = true;
    return;
  }
  try {
    const exists = await client.indices.exists({ index: INDEX });
    if (!exists) {
      await client.indices.create({
        index: INDEX,
        mappings: {
          properties: {
            dataset_id: { type: "keyword" },
            title: { type: "text" },
            description: { type: "text" },
            domain: { type: "keyword" },
            owner_department: { type: "keyword" },
            classification: { type: "keyword" },
            spatial_region_name: { type: "text" },
            spatial_extent: { type: "geo_shape" },
            period_start: { type: "date" },
            period_end: { type: "date" },
            created_at: { type: "date" },
          },
        },
      });
      console.log(`[search] created Elasticsearch index "${INDEX}"`);
    }
  } catch (err) {
    console.warn("[search] Elasticsearch unavailable, using database search fallback");
    useLocalSearch = true;
  }
}

/**
 * Builds an Elasticsearch geo_shape "envelope" from a lat/lng bounding box.
 * GeoJSON envelope format is [[minLng, maxLat], [maxLng, minLat]]
 * (top-left corner, bottom-right corner) — easy to mix up, this is the
 * one place that conversion happens.
 */
function toEnvelope({ minLat, maxLat, minLng, maxLng }) {
  if ([minLat, maxLat, minLng, maxLng].some((v) => v === null || v === undefined)) {
    return null;
  }
  return {
    type: "envelope",
    coordinates: [
      [minLng, maxLat],
      [maxLng, minLat],
    ],
  };
}

async function indexDataset(doc) {
  if (!useLocalSearch && client) {
    try {
      const spatialExtent = toEnvelope({
        minLat: doc.spatial_min_lat,
        maxLat: doc.spatial_max_lat,
        minLng: doc.spatial_min_lng,
        maxLng: doc.spatial_max_lng,
      });

      await client.index({
        index: INDEX,
        id: doc.dataset_id,
        document: { ...doc, spatial_extent: spatialExtent },
        refresh: "wait_for",
      });
      return;
    } catch (err) {
      useLocalSearch = true;
    }
  }
}

async function searchDatasets({ query, domain, department, periodFrom, periodTo, bbox }) {
  if (!useLocalSearch && client) {
    try {
      const must = [];
      if (query) {
        must.push({
          multi_match: {
            query,
            fields: ["title^3", "description", "spatial_region_name"],
            fuzziness: "AUTO",
          },
        });
      }
      const filter = [];
      if (domain) filter.push({ term: { domain } });
      if (department) filter.push({ term: { owner_department: department } });
      if (periodFrom || periodTo) {
        filter.push({
          range: {
            period_start: {
              ...(periodFrom ? { gte: periodFrom } : {}),
              ...(periodTo ? { lte: periodTo } : {}),
            },
          },
        });
      }
      if (bbox) {
        const shape = toEnvelope(bbox);
        if (shape) {
          filter.push({
            geo_shape: {
              spatial_extent: { shape, relation: "intersects" },
            },
          });
        }
      }

      const result = await client.search({
        index: INDEX,
        query: { bool: { must: must.length ? must : [{ match_all: {} }], filter } },
        size: 25,
      });

      return result.hits.hits.map((h) => ({ score: h._score, ...h._source }));
    } catch (err) {
      useLocalSearch = true;
    }
  }

  // Local fallback: search from postgres / DB pool
  const pool = require("../db/pool");
  const params = [];
  let sql = `SELECT d.id as dataset_id, d.title, d.description, d.domain, d.owner_department, d.classification, d.created_at
             FROM datasets d WHERE d.status = 'active'`;
  if (query) {
    params.push(`%${query}%`);
    sql += ` AND (d.title ILIKE $${params.length} OR d.description ILIKE $${params.length})`;
  }
  if (domain) {
    params.push(domain);
    sql += ` AND d.domain = $${params.length}`;
  }
  if (department) {
    params.push(department);
    sql += ` AND d.owner_department = $${params.length}`;
  }
  sql += ` ORDER BY d.created_at DESC LIMIT 25`;

  try {
    const { rows } = await pool.query(sql, params);
    return rows.map((r) => ({ score: 1.0, ...r }));
  } catch (err) {
    return [];
  }
}

module.exports = { client, ensureIndex, indexDataset, searchDatasets, toEnvelope };

