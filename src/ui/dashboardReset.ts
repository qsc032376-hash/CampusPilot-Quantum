import type { ScheduleRequest, ScheduleResponse } from '../types.ts';

export interface DashboardState {
  request: ScheduleRequest;
  result: ScheduleResponse | null;
  message: string | null;
  selectedId: string | null;
  formKey: number;
}

/**
 * Reset contract for the whole dashboard.
 *
 * The form is controlled by `formKey`: changing it remounts TaskForm so the
 * draft title, duration, deadline and any validation error are discarded. No
 * other interaction touches the key, so typing or adding a task never makes the
 * form lose its state.
 */
export function createResetState(initialRequest: ScheduleRequest, currentFormKey: number): DashboardState {
  return {
    request: initialRequest,
    result: null,
    message: null,
    selectedId: null,
    formKey: currentFormKey + 1,
  };
}
