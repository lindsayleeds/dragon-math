import { useCallback, useEffect, useState } from 'react';
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

export function useDialog() {
  const [state, setState] = useState(null);

  const confirm = useCallback((opts) => new Promise(resolve => {
    setState({
      confirmLabel: 'OK',
      cancelLabel: 'Cancel',
      ...opts,
      onConfirm: () => { setState(null); resolve(true); },
      onCancel: () => { setState(null); resolve(false); },
    });
  }), []);

  const alert = useCallback((opts) => new Promise(resolve => {
    const normalized = typeof opts === 'string' ? { message: opts } : opts;
    setState({
      confirmLabel: 'OK',
      ...normalized,
      cancelLabel: null,
      onConfirm: () => { setState(null); resolve(); },
      onCancel: () => { setState(null); resolve(); },
    });
  }), []);

  const dialog = state ? <ConfirmModal {...state} /> : null;
  return { confirm, alert, dialog };
}
