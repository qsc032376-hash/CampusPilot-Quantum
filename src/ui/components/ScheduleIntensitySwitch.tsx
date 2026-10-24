import type { ScheduleIntensity } from '../../features/schedule-intensity/index.ts';

interface ScheduleIntensitySwitchProps {
  intensity: ScheduleIntensity;
  onChange: (intensity: ScheduleIntensity) => void;
}

/**
 * Compact pace selector for Build and every replanning entry.
 *
 * It describes the rhythm of the personal study plan only. It never claims that
 * every task fits, and says nothing about whether a location is open, has space
 * or is booked.
 */
export function ScheduleIntensitySwitch({ intensity, onChange }: ScheduleIntensitySwitchProps) {
  return (
    <div className="cp-intensity">
      <p className="cp-field__label" id="cp-intensity-label">
        Pace
      </p>
      <div className="cp-presets" role="group" aria-labelledby="cp-intensity-label">
        <button
          type="button"
          className={`cp-preset${intensity === 'relaxed' ? ' is-active' : ''}`}
          aria-pressed={intensity === 'relaxed'}
          onClick={() => onChange('relaxed')}
        >
          Relaxed
        </button>
        <button
          type="button"
          className={`cp-preset${intensity === 'intense' ? ' is-active' : ''}`}
          aria-pressed={intensity === 'intense'}
          onClick={() => onChange('intense')}
        >
          High intensity
        </button>
      </div>
      <p className="cp-hint">
        {intensity === 'relaxed'
          ? 'Aims for 15-minute breaks; breaks may be shortened to fit tasks.'
          : 'Schedules without planned breaks.'}
      </p>
    </div>
  );
}
