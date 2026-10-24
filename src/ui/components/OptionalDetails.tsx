import { useId, useState } from 'react';
import type { ReactNode } from 'react';

interface OptionalDetailsProps {
  /** Short summary shown while collapsed, e.g. "Location: Not set". */
  summary: string;
  children: ReactNode;
}

/**
 * One compact row that reveals the optional task fields on demand.
 *
 * Keeps the create form focused on title, duration, deadline and mode while the
 * extra metadata stays one click away. Its open state lives here, so switching
 * task mode or hiding the form keeps whatever the user had open.
 */
export function OptionalDetails({ summary, children }: OptionalDetailsProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="cp-optional">
      <button
        type="button"
        className="cp-optional__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="cp-optional__label">Optional details</span>
        <span className="cp-optional__summary">{summary}</span>
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
