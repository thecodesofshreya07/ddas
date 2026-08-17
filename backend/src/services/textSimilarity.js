/**
 * Lightweight semantic similarity over dataset title+description using
 * TF-IDF + cosine similarity. No external AI API, no GPU — runs instantly
 * and is fully explainable, which matters more than raw accuracy for a
 * government-context demo (see the doc's "AI should never be the sole
 * authorization/decision mechanism" principle — this is a *signal*, not
 * a gate).
 */

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function termFrequencies(tokens) {
  const tf = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  const total = tokens.length || 1;
  for (const k of Object.keys(tf)) tf[k] /= total;
  return tf;
}

/**
 * Computes IDF across a corpus of documents (array of token arrays).
 */
function inverseDocFrequencies(corpusTokens) {
  const df = {};
  for (const tokens of corpusTokens) {
    const seen = new Set(tokens);
    for (const t of seen) df[t] = (df[t] || 0) + 1;
  }
  const idf = {};
  const N = corpusTokens.length || 1;
  for (const term of Object.keys(df)) {
    idf[term] = Math.log(N / df[term]) + 1;
  }
  return idf;
}

function tfidfVector(tokens, idf) {
  const tf = termFrequencies(tokens);
  const vec = {};
  for (const term of Object.keys(tf)) {
    vec[term] = tf[term] * (idf[term] || 1);
  }
  return vec;
}

function cosineSimilarity(vecA, vecB) {
  const terms = new Set([...Object.keys(vecA), ...Object.keys(vecB)]);
  let dot = 0,
    magA = 0,
    magB = 0;
  for (const t of terms) {
    const a = vecA[t] || 0;
    const b = vecB[t] || 0;
    dot += a * b;
    magA += a * a;
    magB += b * b;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * @param {string} textA
 * @param {string} textB
 * @param {string[]} corpus - other documents' text, to compute IDF against
 *                            (falls back to just A+B if no corpus given)
 * @returns {number} 0-100 similarity score
 */
function textSimilarityScore(textA, textB, corpus = []) {
  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);
  const corpusTokens = [tokensA, tokensB, ...corpus.map(tokenize)];

  const idf = inverseDocFrequencies(corpusTokens);
  const vecA = tfidfVector(tokensA, idf);
  const vecB = tfidfVector(tokensB, idf);

  const sim = cosineSimilarity(vecA, vecB);
  return Math.round(sim * 100 * 100) / 100;
}

module.exports = { textSimilarityScore, tokenize };
