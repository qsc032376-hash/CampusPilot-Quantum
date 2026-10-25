export type AssistantDraftTask = {
  title: string;
  durationMinutes: number;
  dueAt: string;
  priority?: 'low' | 'medium' | 'high';
  courseCode?: string;
  locationName?: string;
};

export type AssistantReply =
  | { kind: 'question'; question: string }
  | { kind: 'draft'; tasks: AssistantDraftTask[]; notes: string[] };

export type AssistantResult =
  | { status: 'ok'; reply: AssistantReply }
  | { status: 'unconfigured' }
  | { status: 'error'; message: string };

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

const ENDPOINT = '/api/assistant';

/**
 * Talks to the deployment's own function. No key ever reaches the browser:
 * the function reads AI_API_KEY, AI_BASE_URL and AI_MODEL on the server.
 */
export async function askAssistant(
  messages: AssistantMessage[],
  context: { today: string; locationNames: string[] },
): Promise<AssistantResult> {
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, today: context.today, locationNames: context.locationNames }),
    });
    if (response.status === 503) return { status: 'unconfigured' };
    if (!response.ok) {
      let message = 'The assistant could not answer. Try again.';
      try {
        const data = await response.json();
        if (data && typeof data.message === 'string') message = data.message;
      } catch { /* keep the default */ }
      return { status: 'error', message };
    }
    const data = await response.json();
    if (data && data.kind === 'question' && typeof data.question === 'string') {
      return { status: 'ok', reply: { kind: 'question', question: data.question } };
    }
    if (data && data.kind === 'draft' && Array.isArray(data.tasks)) {
      return {
        status: 'ok',
        reply: {
          kind: 'draft',
          tasks: data.tasks,
          notes: Array.isArray(data.notes) ? data.notes.filter((note: unknown) => typeof note === 'string') : [],
        },
      };
    }
    return { status: 'error', message: 'The assistant returned an unexpected reply.' };
  } catch {
    return { status: 'error', message: 'The assistant is unreachable right now.' };
  }
}
