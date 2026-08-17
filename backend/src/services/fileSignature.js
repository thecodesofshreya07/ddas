/**
 * Real content-signature validation — checks the file's actual first bytes
 * against known magic numbers, not just its declared MIME type (which the
 * browser/client can say anything). This is NOT malware scanning; it's the
 * cheap, honest layer that catches "renamed .exe as .csv" style spoofing
 * without needing an antivirus engine. Full malware sandboxing remains
 * explicitly out of scope — see README.
 */
const SIGNATURES = {
  pdf: [{ bytes: [0x25, 0x50, 0x44, 0x46] }], // %PDF
  png: [{ bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  jpeg: [{ bytes: [0xff, 0xd8, 0xff] }],
};

// CSV/JSON have no reliable binary signature — they're plain text — so we
// fall back to a structural sanity check instead of a magic number.
function looksLikeCsvOrText(buffer) {
  const sample = buffer.subarray(0, Math.min(512, buffer.length));
  let printable = 0;
  for (const byte of sample) {
    if ((byte >= 0x20 && byte <= 0x7e) || byte === 0x09 || byte === 0x0a || byte === 0x0d) {
      printable++;
    }
  }
  return sample.length === 0 || printable / sample.length > 0.85;
}

function looksLikeJson(buffer) {
  const sample = buffer.subarray(0, 64).toString("utf8").trimStart();
  return sample.startsWith("{") || sample.startsWith("[");
}

function matchesSignature(buffer, format) {
  if (format === "csv") return looksLikeCsvOrText(buffer);
  if (format === "json") return looksLikeJson(buffer) || looksLikeCsvOrText(buffer);

  const candidates = SIGNATURES[format];
  if (!candidates) return true; // unknown format — nothing to check against

  return candidates.some((sig) =>
    sig.bytes.every((b, i) => buffer[i] === b)
  );
}

module.exports = { matchesSignature };
