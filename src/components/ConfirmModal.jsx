import { useEffect } from 'react';
import styles from '../styles/ConfirmModal.module.css';

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel,
  tone = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onCancel?.();
      else if (e.key === 'Enter' && !busy) onConfirm?.();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, onConfirm, busy]);

  return (
    <div className={styles.overlay} onClick={() => onCancel?.()}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
      >
        {title && <h3 className={styles.title}>{title}</h3>}
        <p className={styles.message}>{message}</p>
        <div className={styles.actions}>
          {cancelLabel && (
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onCancel}
              disabled={busy}
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            className={tone === 'danger' ? styles.dangerBtn : styles.confirmBtn}
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

