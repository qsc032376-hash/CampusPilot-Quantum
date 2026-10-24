import { useId, useState } from 'react';
import type { ReactNode } from 'react';

interface OptionalDetailsProps {
  /** Title of the disclosure row. */
  label?: string;
  /** Short summary shown while collapsed, e.g. "Custom location set". */
  summary: string;
  /** Full text kept in the title attribute so a long name stays readable. */
  fullSummary?: string;
  children: ReactNode;
  /** Controlled open state; used to force the panel open when a form error needs it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * A compact two-line disclosure: label and summary on the left, a dedicated
 * expand button on the right.
 *
 * Keeping the button separate means the summary never collides with the chevron
 * and can wrap or truncate on its own. The full text stays available through the
 * title attribute, and the button carries the accessible expand/collapse name.
 */
export function OptionalDetails({
  label = 'Optional details',
  summary,
  fullSummary,
  children,
  open: controlledOpen,
  onOpenChange,
}: OptionalDetailsProps) {
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
      <div className="cp-optional__row">
        <div className="cp-optional__text">
          <span className="cp-optional__label">{label}</span>
          <span className="cp-optional__summary" title={fullSummary ?? summary}>
            {summary}
          </span>
        </div>
        <button
          type="button"
          className="cp-optional__toggle"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${open ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          onClick={toggle}
        >
          <span aria-hidden="true">{open ? '−' : '+'}</span>
        </button>
      </div>
      <div className="cp-optional__panel" id={panelId} hidden={!open}>
        {children}
      </div>
    </div>
  );
}
