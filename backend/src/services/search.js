const { Client } = require("@elastic/elasticsearch");

const client = new Client({ node: process.env.ELASTICSEARCH_URL });
const INDEX = process.env.ELASTICSEARCH_INDEX;

async function ensureIndex() {
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
          // Real geospatial field: an "envelope" (bounding box) shape per
          // dataset. Lets us run genuine geo_shape intersects queries
          // ("find datasets covering this region") rather than only doing
          // bbox math in application code at ingestion time.
          spatial_extent: { type: "geo_shape" },
          period_start: { type: "date" },
          period_end: { type: "date" },
          created_at: { type: "date" },
        },
      },
    });
    console.log(`[search] created index "${INDEX}"`);
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
    refresh: "wait_for", // demo-friendly: searchable immediately after upload
  });
}

/**
 * Full-text + filtered search. Classification filtering happens again at
 * the API layer via the policy engine — this is a discovery aid, not the
 * authorization boundary (Elasticsearch is never the source of truth for
 * "can this user see this").
 */
/**
 * @param {object} params
 * @param {number} [params.bbox.minLat/maxLat/minLng/maxLng] - optional
 *   "find datasets whose spatial extent intersects this region" filter.
 *   This is a genuine geo_shape query, not application-side bbox math.
 */
async function searchDatasets({ query, domain, department, periodFrom, periodTo, bbox }) {
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
}

module.exports = { client, ensureIndex, indexDataset, searchDatasets, toEnvelope };
