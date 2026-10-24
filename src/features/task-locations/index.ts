import type { CampusLocation, TaskLocation } from '../../types.ts';

export const MAX_CUSTOM_LOCATION_LENGTH = 120;

/** Copy/normalize display metadata; never infer coordinates or availability. */
export function normalizeTaskLocation(value: unknown): TaskLocation | undefined {
  if (value === undefined) return undefined; // Legacy omission only.
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Task location must be none, campus or custom.');
  }
  const location = value as Record<string, unknown>;
  switch (location.kind) {
    case 'none': return { kind: 'none' };
    case 'campus':
      if (typeof location.locationId !== 'string' || !location.locationId.trim()) {
        throw new Error('A configured campus location ID is required.');
      }
      return { kind: 'campus', locationId: location.locationId };
    case 'custom': {
      if (typeof location.name !== 'string') throw new Error('A custom location name is required.');
      const name = location.name.trim();
      if (!name || name.length > MAX_CUSTOM_LOCATION_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) {
        throw new Error('Custom location names must contain 1–120 characters and no control characters.');
      }
      return { kind: 'custom', name };
    }
    default: throw new Error('Task location must be none, campus or custom.');
  }
}

/** Validate explicit campus IDs against caller configuration, never fall back. */
export function resolveTaskLocation(value: unknown, locations: readonly CampusLocation[]): TaskLocation | undefined {
  const location = normalizeTaskLocation(value);
  if (location?.kind === 'campus' && !locations.some(item => item.id === location.locationId)) {
    throw new Error(`Task campus location is not configured: ${location.locationId}`);
  }
  return location;
}

/** Explicit selections only. Render the returned name as text, never HTML/URL. */
export function taskLocationLabel(value: TaskLocation, locations: readonly CampusLocation[]): string | null {
  const location = resolveTaskLocation(value, locations);
  if (location?.kind === 'custom') return location.name;
  if (location?.kind === 'campus') return locations.find(item => item.id === location.locationId)!.name;
  return null;
}
