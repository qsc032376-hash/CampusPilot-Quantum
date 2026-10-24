import type { CampusLocation } from '../../types.ts';
import type { LocationDraft } from '../taskLocationDraft.ts';

interface TaskLocationFieldProps {
  idPrefix: string;
  locations: readonly CampusLocation[];
  draft: LocationDraft;
  onChange: (next: LocationDraft) => void;
  /** Editing a legacy value offers "keep the existing default" instead of none. */
  allowLegacy: boolean;
  /** Optional error association for the custom-name input. */
  describedBy?: string;
  invalid?: boolean;
}

/**
 * Compact per-task location picker.
 *
 * This is display metadata for the personal plan only: it never claims a room is
 * open, available or booked, and it does not feed the recommender.
 */
export function TaskLocationField({
  idPrefix,
  locations,
  draft,
  onChange,
  allowLegacy,
  describedBy,
  invalid = false,
}: TaskLocationFieldProps) {
  const selectId = `${idPrefix}-location`;
  const customId = `${idPrefix}-location-custom`;

  const value =
    draft.choice === 'legacy'
      ? 'legacy'
      : draft.choice === 'custom'
        ? 'other'
        : draft.choice === 'campus'
          ? `campus:${draft.locationId}`
          : 'none';

  function handleSelect(next: string) {
    if (next === 'legacy') return onChange({ ...draft, choice: 'legacy' });
    if (next === 'none') return onChange({ ...draft, choice: 'none' });
    if (next === 'other') return onChange({ ...draft, choice: 'custom' });
    const locationId = next.startsWith('campus:') ? next.slice('campus:'.length) : draft.locationId;
    onChange({ ...draft, choice: 'campus', locationId });
  }

  return (
    <div className="cp-field-row cp-field-row--split">
      <label className="cp-field" htmlFor={selectId}>
        <span className="cp-field__label">Location</span>
        <select id={selectId} className="cp-input" value={value} onChange={(event) => handleSelect(event.target.value)}>
          {allowLegacy && draft.choice === 'legacy' && (
            <option value="legacy">Keep existing default</option>
          )}
          <option value="none">No location set</option>
          {locations.map((location) => (
            <option key={location.id} value={`campus:${location.id}`}>
              {location.name}
            </option>
          ))}
          <option value="other">Other (custom name)</option>
        </select>
      </label>

      {draft.choice === 'custom' ? (
        <label className="cp-field" htmlFor={customId}>
          <span className="cp-field__label">Custom location</span>
          <input
            id={customId}
            className="cp-input"
            value={draft.customName}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            maxLength={140}
            autoComplete="off"
            placeholder="My desk"
            onChange={(event) => onChange({ ...draft, customName: event.target.value })}
          />
        </label>
      ) : (
        <p className="cp-field__hint">Shown with the task only; never a booking.</p>
      )}
    </div>
  );
}
