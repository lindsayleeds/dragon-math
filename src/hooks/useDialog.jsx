import { useCallback, useState } from 'react';
import { ConfirmModal } from '../components/ConfirmModal';

// Promise-based confirm()/alert() built on <ConfirmModal>. Returns the modal
// element to render alongside the caller's own markup:
//
//   const { confirm, dialog } = useDialog();
//   if (await confirm({ message: 'Delete?', cancelLabel: 'Keep' })) …
//   return <>{dialog}…</>;
//
// It lives here rather than beside ConfirmModal so that file exports only a
// component, which is what Fast Refresh needs to preserve state across edits.
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
