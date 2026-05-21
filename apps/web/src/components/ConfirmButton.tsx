import { useState } from 'react';

interface Props {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
  style?: React.CSSProperties;
  confirmStyle?: React.CSSProperties;
}

export function ConfirmButton({ label, confirmLabel = 'Yes', onConfirm, disabled, style, confirmStyle }: Props) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-fg-muted)' }}>Are you sure?</span>
        <button
          type="button"
          onClick={async () => {
            setConfirming(false);
            await onConfirm();
          }}
          style={{ fontSize: 'var(--text-xs)', padding: '0 var(--space-2)', height: '24px', cursor: 'pointer', ...confirmStyle }}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          aria-label="Cancel"
          onClick={() => setConfirming(false)}
          style={{ fontSize: 'var(--text-xs)', padding: '0 var(--space-2)', height: '24px', cursor: 'pointer', background: 'none', border: 'var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-fg-muted)' }}
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button type="button" onClick={() => setConfirming(true)} disabled={disabled} style={style}>
      {label}
    </button>
  );
}
