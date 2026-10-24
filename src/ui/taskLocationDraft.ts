import type { CampusLocation, StudyBlock, TaskLocation } from '../types.ts';
import { MAX_CUSTOM_LOCATION_LENGTH, taskLocationLabel } from '../features/task-locations/index.ts';

/**
 * Pure helpers for the task-location UI.
 *
 * `undefined` is the legacy "no explicit choice" mode and must survive an edit
 * untouched. `{ kind: 'none' }` is an explicit "no location" and never falls
 * back to a default.
 */

export type LocationChoice = 'none' | 'campus' | 'custom' | 'legacy';

export interface LocationDraft {
  choice: LocationChoice;
  /** Campus location id, only meaningful when choice is 'campus'. */
  locationId: string;
  /** Raw text of the custom name field. */
  customName: string;
}

export function defaultLocationDraft(locations: readonly CampusLocation[], legacy = false): LocationDraft {
  return {
    choice: legacy ? 'legacy' : 'none',
    locationId: locations[0]?.id ?? '',
    customName: '',
  };
}

export type TaskLocationResult =
  | { ok: true; location: TaskLocation | undefined }
  | { ok: false; message: string };

/** Turns the draft into the value A expects, or a message the form can show. */
export function buildTaskLocation(
  draft: LocationDraft,
  locations: readonly CampusLocation[],
): TaskLocationResult {
  if (draft.choice === 'legacy') return { ok: true, location: undefined };
  if (draft.choice === 'none') return { ok: true, location: { kind: 'none' } };
  if (draft.choice === 'campus') {
    if (!locations.some((location) => location.id === draft.locationId)) {
      return { ok: false, message: 'Choose a campus location.' };
    }
    return { ok: true, location: { kind: 'campus', locationId: draft.locationId } };
  }
  const name = draft.customName.trim();
  if (!name) return { ok: false, message: 'Enter a name for the custom location.' };
  if (name.length > MAX_CUSTOM_LOCATION_LENGTH) {
    return { ok: false, message: `Keep the custom location under ${MAX_CUSTOM_LOCATION_LENGTH} characters.` };
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    return { ok: false, message: 'Custom location names cannot contain control characters.' };
  }
  return { ok: true, location: { kind: 'custom', name } };
}

/** Draft for editing an existing value; undefined means legacy, not none. */
export function draftFromLocation(
  location: TaskLocation | undefined,
  locations: readonly CampusLocation[],
): LocationDraft {
  if (location === undefined) return defaultLocationDraft(locations, true);
  if (location.kind === 'none') return { ...defaultLocationDraft(locations), choice: 'none' };
  if (location.kind === 'campus') {
    return { choice: 'campus', locationId: location.locationId, customName: '' };
  }
  return { choice: 'custom', locationId: locations[0]?.id ?? '', customName: location.name };
}

/** Collapsed summary for the optional-details row. */
export function locationSummary(draft: LocationDraft, locations: readonly CampusLocation[]): string {
  if (draft.choice === 'legacy') return 'Location: Keep existing default';
  if (draft.choice === 'campus') {
    const found = locations.find((location) => location.id === draft.locationId);
    return `Location: ${found ? found.name : 'Not set'}`;
  }
  if (draft.choice === 'custom') {
    const name = draft.customName.trim();
    return `Location: ${name || 'Not set'}`;
  }
  return 'Location: Not set';
}

export type BlockLocationDisplay =
  | { kind: 'legacy'; locationId: string }
  | { kind: 'none' }
  | { kind: 'campus'; name: string; locationId: string }
  | { kind: 'custom'; name: string };

/** What the Where card should show for one scheduled block. */
export function describeBlockLocation(
  block: Pick<StudyBlock, 'location' | 'locationId'>,
  locations: readonly CampusLocation[],
): BlockLocationDisplay {
  const location = block.location;
  if (location) {
    if (location.kind === 'none') return { kind: 'none' };
    if (location.kind === 'custom') return { kind: 'custom', name: location.name };
    let name = location.locationId;
    try {
      name = taskLocationLabel(location, locations) ?? location.locationId;
    } catch {
      name = location.locationId;
    }
    return { kind: 'campus', locationId: location.locationId, name };
  }
  if (block.locationId) return { kind: 'legacy', locationId: block.locationId };
  return { kind: 'none' };
}
