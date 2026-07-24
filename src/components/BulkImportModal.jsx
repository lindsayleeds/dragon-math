import { useMemo, useState } from 'react';
import { parseCsv, toCsv, downloadCsv } from '../utils/csv';
import styles from '../styles/ParentDashboard.module.css';

// Column header aliases we accept in an uploaded CSV, so a spreadsheet exported
// with slightly different labels still maps cleanly. Keys are the canonical
// field; values are the header spellings (already lowercased) that map to it.
const ALIASES = {
  teacher_email: ['teacher_email', 'teacher email', 'teacher', 'email'],
  class: ['class', 'classroom', 'class name', 'room'],
  real_name: ['real_name', 'real name', 'name', 'student', 'student name', 'full name'],
  handle: ['handle', 'username', 'user name', 'login'],
};

const TEMPLATE = [
  'teacher_email,class,real_name,handle',
  'ms.garcia@school.org,Room 4,Jordan Lee,jordan4',
  'ms.garcia@school.org,Room 4,Maya Ruiz,',
  'mr.okafor@school.org,Room 7,Sam Patel,sam_p',
].join('\r\n');

// Pull a canonical field out of a parsed row object using the alias list.
function pick(row, field) {
  for (const key of ALIASES[field]) {
    if (row[key] != null && row[key] !== '') return row[key];
  }
  return '';
}

// Bulk-import students into the school from a CSV. The client parses the file and
// posts JSON rows; the server (POST /api/school/:id/students/import) matches each
// teacher + class, creates accounts, and reports per-row outcomes. `onImport`
// takes the rows array and resolves to the server response.
export function BulkImportModal({ onImport, onClose }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  // Parse whatever's in the textarea into canonical rows, tagging each with its
  // source line (1-based, counting the header) for readable error messages.
  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    const { headers, rows } = parseCsv(text);
    const hasTeacher = ALIASES.teacher_email.some(a => headers.includes(a));
    const hasClass = ALIASES.class.some(a => headers.includes(a));
    const hasName = ALIASES.real_name.some(a => headers.includes(a));
    const mapped = rows.map((r, i) => ({
      line: i + 2,
      teacher_email: pick(r, 'teacher_email'),
      class: pick(r, 'class'),
      real_name: pick(r, 'real_name'),
      handle: pick(r, 'handle'),
    }));
    return { headers, hasTeacher, hasClass, hasName, rows: mapped };
  }, [text]);

  const headerError = parsed && !(parsed.hasTeacher && parsed.hasClass && parsed.hasName)
    ? 'Your file needs a header row with columns for teacher email, class, and real name.'
    : null;

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      setText(await file.text());
    } catch {
      setError('Could not read that file.');
    }
  }

  async function handleImport() {
    if (!parsed || headerError) return;
    setBusy(true);
    setError(null);
    try {
      const res = await onImport(parsed.rows);
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Build a login-links CSV for the just-created kids so the admin can hand out
  // /k/<token> URLs (bulk-created kids have no password — the link IS their login).
  function downloadLoginLinks() {
    const made = result.results.filter(r => r.status === 'created').map(r => r.student);
    const origin = window.location.origin;
    const csv = toCsv(made, [
      { key: 'real_name', label: 'real_name' },
      { label: 'handle', value: s => s.username || '(picks own on first login)' },
      { key: 'class', label: 'class' },
      { key: 'teacher_email', label: 'teacher_email' },
      { label: 'login_url', value: s => `${origin}/k/${s.login_token}` },
    ]);
    downloadCsv('dragon-math-login-links.csv', csv);
  }

  const errorRows = result ? result.results.filter(r => r.status === 'error') : [];

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: 640, width: '92vw' }}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>

        {!result ? (
          <>
            <h3>Import students</h3>
            <p className={styles.muted}>
              Upload a CSV with one row per student. Each row names the{' '}
              <strong>teacher’s email</strong> (they must already be in this school) and a{' '}
              <strong>class</strong> — we’ll create the class if it doesn’t exist. Real name is
              required; handle is optional (leave blank and the student picks their own on first
              login). You’ll get their login links after import.
            </p>

            <div className={styles.qrActions} style={{ margin: '10px 0' }}>
              <label className={styles.primaryBtn} style={{ cursor: 'pointer' }}>
                Choose CSV file
                <input type="file" accept=".csv,text/csv" onChange={handleFile} style={{ display: 'none' }} disabled={busy} />
              </label>
              <button
                className={styles.linkBtn}
                type="button"
                onClick={() => downloadCsv('dragon-math-import-template.csv', '﻿' + TEMPLATE)}
              >
                Download template
              </button>
            </div>

            <label className={styles.label}>
              …or paste CSV here
              <textarea
                className={styles.input}
                value={text}
                onChange={e => { setText(e.target.value); setError(null); }}
                placeholder={'teacher_email,class,real_name,handle\nms.garcia@school.org,Room 4,Jordan Lee,jordan4'}
                rows={5}
                spellCheck={false}
                style={{ fontFamily: 'monospace', fontSize: 13, resize: 'vertical' }}
                disabled={busy}
              />
            </label>

            {headerError && <p className={styles.error}>{headerError}</p>}

            {parsed && !headerError && (
              <>
                <p className={styles.muted} style={{ marginBottom: 6 }}>
                  {parsed.rows.length} {parsed.rows.length === 1 ? 'student' : 'students'} ready to import.
                </p>
                <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8 }}>
                  <table className={styles.table} style={{ margin: 0 }}>
                    <thead>
                      <tr><th>teacher</th><th>class</th><th>real name</th><th>handle</th></tr>
                    </thead>
                    <tbody>
                      {parsed.rows.slice(0, 20).map((r, i) => (
                        <tr key={i}>
                          <td>{r.teacher_email || <span className={styles.error}>—</span>}</td>
                          <td>{r.class || <span className={styles.error}>—</span>}</td>
                          <td>{r.real_name || <span className={styles.error}>—</span>}</td>
                          <td className={styles.muted}>{r.handle || 'picks own'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {parsed.rows.length > 20 && (
                  <p className={styles.muted} style={{ fontSize: 12 }}>…and {parsed.rows.length - 20} more.</p>
                )}
              </>
            )}

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.qrActions} style={{ marginTop: 12 }}>
              <button
                className={styles.primaryBtn}
                type="button"
                onClick={handleImport}
                disabled={busy || !parsed || !!headerError || parsed.rows.length === 0}
              >
                {busy ? 'Importing…' : `Import ${parsed && !headerError ? parsed.rows.length : ''} student${parsed && parsed.rows.length === 1 ? '' : 's'}`}
              </button>
              <button className={styles.linkBtn} type="button" onClick={onClose} disabled={busy}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <h3>Import complete</h3>
            <p className={styles.muted}>
              <strong>{result.summary.created}</strong> of {result.summary.total} students created
              {result.summary.errors > 0 && <> · <span className={styles.error}>{result.summary.errors} skipped</span></>}
              {result.summary.created_classes.length > 0 && (
                <> · {result.summary.created_classes.length} new{' '}
                  {result.summary.created_classes.length === 1 ? 'class' : 'classes'} created</>
              )}.
            </p>

            {result.summary.created > 0 && (
              <>
                <p className={styles.muted}>
                  New students sign in with a personal link — download and share them.
                </p>
                <div className={styles.qrActions}>
                  <button className={styles.primaryBtn} type="button" onClick={downloadLoginLinks}>
                    Download login links (CSV)
                  </button>
                </div>
              </>
            )}

            {errorRows.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <p className={styles.error} style={{ marginBottom: 6 }}>Skipped rows:</p>
                <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8 }}>
                  <table className={styles.table} style={{ margin: 0 }}>
                    <thead><tr><th>line</th><th>reason</th></tr></thead>
                    <tbody>
                      {errorRows.map((r, i) => (
                        <tr key={i}><td>{r.line}</td><td>{r.reason}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className={styles.qrActions} style={{ marginTop: 14 }}>
              <button className={styles.primaryBtn} type="button" onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
