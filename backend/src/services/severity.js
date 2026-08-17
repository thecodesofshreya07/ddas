/**
 * Severity is derived directly from the similarity engine's own output —
 * not a separate invented scale. exact_duplicate always reads as critical
 * regardless of the numeric score, since a byte-identical file is the
 * clearest possible case regardless of metadata noise.
 */
function computeSeverity(relationshipType, similarityScore) {
  const score = parseFloat(similarityScore);
  if (relationshipType === "exact_duplicate") return "critical";
  if (score >= 90) return "high";
  if (score >= 75) return "medium";
  return "low";
}

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

module.exports = { computeSeverity, SEVERITY_ORDER };
