const { diffArrays, diffLines } = require("diff");
const { parse } = require("csv-parse");
const { Readable } = require("stream");

const MAX_DIFF_BYTES = 5 * 1024 * 1024; // skip content-diffing above this size
const MAX_PREVIEW_ROWS = 25;
const MAX_PREVIEW_LINES = 60;

function parseCsvRows(buffer) {
  return new Promise((resolve, reject) => {
    const rows = [];
    Readable.from(buffer)
      .pipe(parse({ columns: true, skip_empty_lines: true, relax_column_count: true }))
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

/**
 * Row-level CSV diff. Compares column headers directly, then runs an
 * LCS-based diff (diffArrays) over serialized rows to find which rows are
 * genuinely new, removed, or unchanged.
 *
 * Honest limitation, stated rather than hidden: this is order-sensitive.
 * A file with the same rows in a different order will show as many
 * added/removed rows, not zero — there's no per-row identity/key to match
 * on generically. Good enough to answer "what actually changed," not a
 * full semantic row-matching engine.
 */
async function diffCsv(bufferA, bufferB) {
  const [rowsA, rowsB] = await Promise.all([parseCsvRows(bufferA), parseCsvRows(bufferB)]);

  const columnsA = rowsA[0] ? Object.keys(rowsA[0]) : [];
  const columnsB = rowsB[0] ? Object.keys(rowsB[0]) : [];
  const addedColumns = columnsB.filter((c) => !columnsA.includes(c));
  const removedColumns = columnsA.filter((c) => !columnsB.includes(c));

  const serialize = (row) => JSON.stringify(row);
  const seqA = rowsA.map(serialize);
  const seqB = rowsB.map(serialize);

  const parts = diffArrays(seqA, seqB);

  let unchangedCount = 0;
  const addedRows = [];
  const removedRows = [];

  for (const part of parts) {
    if (!part.added && !part.removed) {
      unchangedCount += part.value.length;
    } else if (part.added) {
      for (const v of part.value) {
        if (addedRows.length < MAX_PREVIEW_ROWS) addedRows.push(JSON.parse(v));
      }
    } else if (part.removed) {
      for (const v of part.value) {
        if (removedRows.length < MAX_PREVIEW_ROWS) removedRows.push(JSON.parse(v));
      }
    }
  }

  const totalAdded = parts.filter((p) => p.added).reduce((n, p) => n + p.value.length, 0);
  const totalRemoved = parts.filter((p) => p.removed).reduce((n, p) => n + p.value.length, 0);

  return {
    type: "csv",
    totalRowsA: rowsA.length,
    totalRowsB: rowsB.length,
    unchangedRows: unchangedCount,
    addedRowCount: totalAdded,
    removedRowCount: totalRemoved,
    addedRowsPreview: addedRows,
    removedRowsPreview: removedRows,
    previewTruncated: totalAdded > MAX_PREVIEW_ROWS || totalRemoved > MAX_PREVIEW_ROWS,
    columnsAdded: addedColumns,
    columnsRemoved: removedColumns,
    identical: totalAdded === 0 && totalRemoved === 0 && addedColumns.length === 0 && removedColumns.length === 0,
  };
}

/**
 * Line-level diff for plain-text formats (JSON, etc). Returns counts plus
 * a capped preview of the actual changed lines, prefixed +/- unified-diff
 * style, for direct display in the UI.
 */
function diffText(bufferA, bufferB) {
  const textA = bufferA.toString("utf8");
  const textB = bufferB.toString("utf8");
  const parts = diffLines(textA, textB);

  let unchangedLines = 0;
  let addedLines = 0;
  let removedLines = 0;
  const preview = [];

  for (const part of parts) {
    const lineCount = part.value.split("\n").filter((l, i, arr) => !(i === arr.length - 1 && l === "")).length;
    if (!part.added && !part.removed) {
      unchangedLines += lineCount;
    } else {
      if (part.added) addedLines += lineCount;
      if (part.removed) removedLines += lineCount;
      if (preview.length < MAX_PREVIEW_LINES) {
        const prefix = part.added ? "+" : "-";
        const lines = part.value.split("\n").filter((l) => l.length > 0);
        for (const line of lines) {
          if (preview.length < MAX_PREVIEW_LINES) preview.push(`${prefix} ${line}`);
        }
      }
    }
  }

  return {
    type: "text",
    unchangedLines,
    addedLines,
    removedLines,
    preview,
    previewTruncated: addedLines + removedLines > MAX_PREVIEW_LINES,
    identical: addedLines === 0 && removedLines === 0,
  };
}

/**
 * Entry point. Returns null (not undefined) when a meaningful diff isn't
 * possible — the frontend renders an honest "can't compare this format"
 * message rather than nothing at all.
 */
async function computeContentDiff(bufferA, bufferB, formatA, formatB) {
  if (formatA !== formatB) {
    return { type: "incomparable", reason: `Different file formats (${formatA} vs ${formatB})` };
  }
  if (bufferA.length > MAX_DIFF_BYTES || bufferB.length > MAX_DIFF_BYTES) {
    return { type: "incomparable", reason: "File too large for a detailed content diff" };
  }

  if (formatA === "csv") {
    try {
      return await diffCsv(bufferA, bufferB);
    } catch (err) {
      return { type: "incomparable", reason: "Couldn't parse one or both files as CSV" };
    }
  }
  if (formatA === "json") {
    return diffText(bufferA, bufferB);
  }

  return { type: "incomparable", reason: `Line-by-line comparison isn't supported for ${formatA} files` };
}

module.exports = { computeContentDiff };
