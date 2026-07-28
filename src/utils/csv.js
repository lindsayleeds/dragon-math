// Tiny CSV helpers for the school dashboard's import/export.
//
// No dependency — RFC-4180-ish: fields containing a comma, quote, CR, or LF are
// wrapped in double quotes with embedded quotes doubled. Parsing handles quoted
// fields (with escaped quotes and embedded newlines) and both CRLF/LF line ends.

// Serialize one field: quote it only when it contains a special character.
function escapeField(value) {
  const s = value == null ? '' : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Build a CSV string. `columns` is [{ key, label }]; `rows` are plain objects.
// A leading BOM makes Excel open UTF-8 (e.g. accented names) correctly.
export function toCsv(rows, columns, { bom = true } = {}) {
  const header = columns.map(c => escapeField(c.label ?? c.key)).join(',');
  const body = rows.map(row =>
    columns.map(c => escapeField(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(','),
  );
  return (bom ? '﻿' : '') + [header, ...body].join('\r\n');
}

// Trigger a browser download of `text` as `filename`.
export function downloadCsv(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has surely been dispatched.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Parse CSV text into an array of row objects keyed by the header row.
// Returns { headers: string[], rows: Array<Record<string,string>> }.
// Blank lines are skipped; header keys are lowercased and trimmed.
export function parseCsv(text) {
  const src = text.replace(/^\uFEFF/, ''); // drop a leading BOM if present
  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  let sawAny = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; sawAny = true; continue; }
    if (ch === ',') { record.push(field); field = ''; sawAny = true; continue; }
    if (ch === '\r') continue; // fold CRLF → LF
    if (ch === '\n') {
      record.push(field);
      records.push(record);
      field = ''; record = []; sawAny = false;
      continue;
    }
    field += ch;
    sawAny = true;
  }
  // Flush the trailing record if the file didn't end with a newline.
  if (sawAny || field !== '' || record.length) {
    record.push(field);
    records.push(record);
  }

  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0].map(h => h.trim().toLowerCase());
  const rows = [];
  for (let r = 1; r < records.length; r++) {
    const cells = records[r];
    // Skip fully blank lines.
    if (cells.length === 1 && cells[0].trim() === '') continue;
    const obj = {};
    headers.forEach((h, c) => { obj[h] = (cells[c] ?? '').trim(); });
    rows.push(obj);
  }
  return { headers, rows };
}
