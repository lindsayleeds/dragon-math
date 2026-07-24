import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import styles from '../styles/ParentDashboard.module.css';

// A receipt shown right after one or more school-admin welcome emails go out.
// `receipts` is an array of { email, created, login_link, email_sent }; `bcc` is
// the address every message was blind-copied to (null if nothing sent). Rendered
// by the school dashboard and the site-admin panel — it imports its own modal
// chrome so it looks the same wherever it's used.
export function WelcomeEmailModal({ receipts, bcc, onClose }) {
  const [copiedIdx, setCopiedIdx] = useState(null);
  const list = Array.isArray(receipts) ? receipts : [];
  const plural = list.length !== 1;
  const anySent = list.some(r => r.email_sent);
  const singleLink = list.length === 1 && list[0].login_link
    ? `${window.location.origin}${list[0].login_link}`
    : null;

  async function handleCopy(link, idx) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(c => (c === idx ? null : c)), 1800);
    } catch {
      setCopiedIdx(null);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        <h3>{anySent ? `Welcome email${plural ? 's' : ''} sent` : 'Admin added'}</h3>

        {singleLink && (
          <div className={`${styles.qrPanel} ${styles.qrPrintArea || ''}`}>
            <div className={styles.qrBox}>
              <QRCodeSVG value={singleLink} size={180} level="M" includeMargin />
            </div>
            <div className={styles.qrUrl}>{singleLink}</div>
          </div>
        )}

        <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 0' }}>
          {list.map((r, idx) => {
            const link = r.login_link ? `${window.location.origin}${r.login_link}` : null;
            return (
              <li key={r.email} style={{ padding: '10px 0', borderTop: idx === 0 ? 'none' : '1px solid rgba(0,0,0,.08)' }}>
                <div style={{ fontWeight: 600 }}>
                  {r.email_sent ? '✅ ' : '⚠️ '}
                  {r.email_sent ? 'Sent to ' : 'Could not email '}
                  {r.email}
                </div>
                {!r.email_sent && r.email_error && (
                  <div className={styles.error} style={{ margin: '4px 0 0', fontWeight: 400 }}>
                    {r.email_error}
                  </div>
                )}
                {link ? (
                  !singleLink && (
                    <div className={styles.qrActions} style={{ marginTop: 6 }}>
                      <code style={{ wordBreak: 'break-all', fontSize: 13 }}>{link}</code>
                      <button className={styles.linkBtn} onClick={() => handleCopy(link, idx)}>
                        {copiedIdx === idx ? 'Copied!' : 'Copy link'}
                      </button>
                    </div>
                  )
                ) : (
                  <div className={styles.muted} style={{ marginTop: 4 }}>
                    They sign in with their own password or Google.
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {bcc && (
          <p className={styles.muted} style={{ marginTop: 12 }}>
            Blind-copied to <strong>{bcc}</strong> for your records.
          </p>
        )}

        {singleLink && (
          <div className={styles.qrActions} style={{ marginTop: 8 }}>
            <button className={styles.linkBtn} onClick={() => handleCopy(singleLink, 0)}>
              {copiedIdx === 0 ? 'Copied!' : 'Copy link'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
