import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import styles from '../styles/ParentDashboard.module.css';

function loginUrlFor(token) {
  return `${window.location.origin}/k/${token}`;
}

// Shows a kid's permanent "login by URL" as a scannable QR + copyable link.
// Shared by the parent dashboard and the teacher classroom roster.
export function LoginLinkModal({ child, onClose }) {
  const [copied, setCopied] = useState(false);
  const url = loginUrlFor(child.login_token);
  const name = child.needs_handle ? 'your new adventurer' : child.username;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        <h3>{child.needs_handle ? 'Scan to start' : 'Dragon login link'}</h3>
        <p className={styles.muted}>
          {child.needs_handle
            ? `Have ${name} scan this with a phone or tablet camera. They’ll pick their own name and jump in — no password.`
            : `${name} can scan or bookmark this to sign in anytime — no password.`}
        </p>

        <div className={`${styles.qrPanel} ${styles.qrPrintArea || ''}`}>
          <div className={styles.qrBox}>
            <QRCodeSVG value={url} size={200} level="M" includeMargin />
          </div>
          <div className={styles.qrUrl}>{url}</div>
        </div>

        <div className={styles.qrActions}>
          <button className={styles.primaryBtn} onClick={() => window.print()}>Print</button>
          <button className={styles.linkBtn} onClick={handleCopy}>{copied ? 'Copied!' : 'Copy link'}</button>
        </div>
      </div>
    </div>
  );
}
