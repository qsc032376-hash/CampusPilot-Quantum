export type TaskMode = 'oneoff' | 'recurring';

interface TaskModeSwitchProps {
  mode: TaskMode;
  onChange: (mode: TaskMode) => void;
  /** Saved series still schedule while this pane is hidden; the count shows that. */
  seriesCount: number;
}

/**
 * Compact mode switch for the "Add a study task" panel.
 *
 * It only chooses which form is visible. Both forms stay mounted, so an
 * unsubmitted draft or an open series edit survives a mode change, and switching
 * never adds, removes, converts or re-schedules anything.
 */
export function TaskModeSwitch({ mode, onChange, seriesCount }: TaskModeSwitchProps) {
  return (
    <div className="cp-modetabs" role="group" aria-label="Task type">
      <button
        type="button"
        className={`cp-modetab${mode === 'oneoff' ? ' is-active' : ''}`}
        aria-pressed={mode === 'oneoff'}
        onClick={() => onChange('oneoff')}
      >
        One-time task
      </button>
      <button
        type="button"
        className={`cp-modetab${mode === 'recurring' ? ' is-active' : ''}`}
        aria-pressed={mode === 'recurring'}
        onClick={() => onChange('recurring')}
      >
        Repeating task
        {seriesCount > 0 && (
          <span className="cp-modetab__count" aria-label={`${seriesCount} saved`}>
            {seriesCount}
          </span>
        )}
      </button>
    </div>
  );
}
