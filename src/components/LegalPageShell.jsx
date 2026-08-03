import { Link } from 'react-router-dom';
import { LEGAL_ENTITY, missingLegalFields } from '../data/legalEntity';
import styles from '../styles/LegalPage.module.css';

// Shared chrome for /privacy and /terms: the sheet, the title, and the draft
// banner that both pages must not be able to lose.
//
// The banner is computed, not hand-maintained — it reflects the real state of
// src/data/legalEntity.js. It disappears on its own once every required field is
// filled AND legallyReviewed is set, which is the only combination that makes
// these documents safe to rely on.

// Renders a configured value, or a loud marker if it is still missing. Never
// renders an empty string: a blank where an address should be reads as an
// oversight to a regulator and as nothing at all to a parent.
export function Fill({ value, needs }) {
  if (value) return <>{value}</>;
  return <mark className={styles.needsValue}>[NEEDS: {needs}]</mark>;
}

export function LegalPageShell({ title, children }) {
  const missing = missingLegalFields();
  const draft = missing.length > 0 || !LEGAL_ENTITY.legallyReviewed;

  return (
    <div className={styles.page}>
      <div className={styles.sheet}>
        <Link to="/auth" className={styles.backTab}>← back</Link>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.updated}>Last updated: {LEGAL_ENTITY.lastUpdated}</p>

        {draft && (
          <div className={styles.draftNotice}>
            <strong>Draft — not yet final.</strong> This document describes what My Dragon
            Math actually does today, but it is not ready to be relied on as the published
            policy.
            {missing.length > 0 && (
              <> Still missing: <strong>{missing.join(', ')}</strong>.</>
            )}
            {!LEGAL_ENTITY.legallyReviewed && <> It has not been reviewed by a lawyer.</>}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
