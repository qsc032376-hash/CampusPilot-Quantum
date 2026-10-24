import { useId, useState } from 'react';
import type { ReactNode } from 'react';

interface OptionalDetailsProps {
  /** Short summary shown while collapsed, e.g. "Location: Not set". */
  summary: string;
  children: ReactNode;
  /** Controlled open state; used to force the panel open when a form error needs it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * One compact row that reveals the optional task fields on demand.
 *
 * Keeps the create form focused on title, duration, deadline and mode while the
 * extra metadata stays one click away. The summary keeps its full text in the
 * title attribute so a long custom name stays readable inside a narrow column.
 */
export function OptionalDetails({ summary, children, open: controlledOpen, onOpenChange }: OptionalDetailsProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const panelId = useId();

  function toggle() {
    const next = !open;
    setInternalOpen(next);
    onOpenChange?.(next);
  }

  return (
    <div className="cp-optional">
      <button
        type="button"
        className="cp-optional__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        <span className="cp-optional__label">Optional details</span>
        <span className="cp-optional__summary" title={summary}>
          {summary}
        </span>
        <span className="cp-optional__chevron" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
      <div className="cp-optional__panel" id={panelId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
