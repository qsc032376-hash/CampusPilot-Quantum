/**
 * Vercel Node function: POST /api/assistant
 *
 * Turns a short conversation into structured task drafts for CampusPilot.
 * The model key lives only in the server environment: AI_API_KEY, AI_BASE_URL
 * and AI_MODEL. Nothing here is exposed to the browser, and no chat content is
 * written to logs.
 */
export const config = { runtime: 'nodejs' };

const MAX_BODY_BYTES = 16 * 1024;
const MAX_MESSAGES = 12;
const MAX_MESSAGE_CHARS = 2000;
const MAX_TOKENS = 600;
const MAX_TASKS = 5;
const MAX_NOTES = 3;
const UPSTREAM_TIMEOUT_MS = 20_000;

interface DraftTask {
  title: string;
  durationMinutes: number;
  dueAt: string;
  priority?: 'low' | 'medium' | 'high';
  courseCode?: string;
  locationName?: string;
}

interface AssistantReply {
  kind: 'question' | 'draft';
  question?: string;
  tasks?: DraftTask[];
  notes?: string[];
}

const SYSTEM_PROMPT = [
  'You help a student turn a study request into structured tasks for a planner.',
  'Reply with JSON only: {"kind":"question","question":"..."} when a title, duration or deadline is missing,',
  'otherwise {"kind":"draft","tasks":[{"title","durationMinutes","dueAt","priority?","courseCode?","locationName?"}],"notes":["..."]}.',
  'dueAt must be an ISO 8601 timestamp with an explicit offset such as 2026-10-29T23:00:00-04:00.',
  'durationMinutes is a whole number between 1 and 600. Never invent a location the student did not mention.',
  'Keep at most 5 tasks and at most 3 short notes. Do not schedule times, only describe the work.',
].join(' ');

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function cleanMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null;
  const messages = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null;
    const role = entry.role === 'assistant' ? 'assistant' : entry.role === 'user' ? 'user' : null;
    const content = typeof entry.content === 'string' ? entry.content.trim() : '';
    if (!role || !content || content.length > MAX_MESSAGE_CHARS) return null;
    messages.push({ role, content });
  }
  return messages;
}

function cleanReply(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.kind === 'question') {
    const question = typeof value.question === 'string' ? value.question.trim().slice(0, 400) : '';
    return question ? { kind: 'question', question } : null;
  }
  if (value.kind !== 'draft' || !Array.isArray(value.tasks) || value.tasks.length === 0) return null;
  const tasks = [];
  for (const task of value.tasks.slice(0, MAX_TASKS)) {
    if (!task || typeof task !== 'object') continue;
    const title = typeof task.title === 'string' ? task.title.trim().slice(0, 80) : '';
    const durationMinutes = Number(task.durationMinutes);
    const dueAt = typeof task.dueAt === 'string' ? task.dueAt : '';
    if (!title || !Number.isFinite(Date.parse(dueAt))) continue;
    if (!Number.isSafeInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 600) continue;
    const draft = { title, durationMinutes, dueAt };
    if (task.priority === 'low' || task.priority === 'medium' || task.priority === 'high') draft.priority = task.priority;
    if (typeof task.courseCode === 'string' && task.courseCode.trim()) draft.courseCode = task.courseCode.trim().slice(0, 12);
    if (typeof task.locationName === 'string' && task.locationName.trim()) draft.locationName = task.locationName.trim().slice(0, 120);
    tasks.push(draft);
  }
  if (tasks.length === 0) return null;
  const notes = Array.isArray(value.notes)
    ? value.notes.filter((note) => typeof note === 'string' && note.trim()).slice(0, MAX_NOTES).map((note) => note.trim().slice(0, 200))
    : [];
  return { kind: 'draft', tasks, notes };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    send(res, 405, { error: 'method_not_allowed', message: 'Use POST.' });
    return;
  }
  const apiKey = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL;
  const model = process.env.AI_MODEL;
  if (!apiKey || !baseUrl || !model) {
    send(res, 503, {
      error: 'unconfigured',
      message: 'The AI assistant is not configured on this deployment.',
    });
    return;
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    send(res, 400, { error: 'invalid_request', message: 'Send a JSON body with a messages array.' });
    return;
  }
  const messages = cleanMessages(body && body.messages);
  if (!messages) {
    send(res, 400, { error: 'invalid_request', message: 'messages must be 1-12 short user/assistant entries.' });
    return;
  }
  const today = typeof body.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : '';
  const locations = Array.isArray(body.locationNames)
    ? body.locationNames.filter((name) => typeof name === 'string').slice(0, 12).map((name) => name.slice(0, 80))
    : [];

  const context = [
    today ? 'Today is ' + today + ' (America/New_York).' : '',
    locations.length ? 'Known campus places: ' + locations.join(', ') + '.' : '',
    'The planner will place the work later; do not suggest times.',
  ].filter(Boolean).join(' ');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: SYSTEM_PROMPT + ' ' + context }, ...messages],
      }),
    });
  } catch {
    clearTimeout(timer);
    send(res, 502, { error: 'upstream_unreachable', message: 'The AI service could not be reached.' });
    return;
  }
  clearTimeout(timer);

  if (!upstream.ok) {
    send(res, 502, { error: 'upstream_error', message: 'The AI service returned an error.' });
    return;
  }
  let content = '';
  try {
    const data = await upstream.json();
    content = data && data.choices && data.choices[0] && data.choices[0].message
      ? String(data.choices[0].message.content || '')
      : '';
  } catch {
    send(res, 502, { error: 'upstream_error', message: 'The AI service returned an unreadable reply.' });
    return;
  }
  if (!content) {
    send(res, 502, { error: 'empty_reply', message: 'The AI service returned an empty reply.' });
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    send(res, 502, { error: 'invalid_json', message: 'The AI service did not return valid JSON.' });
    return;
  }
  const reply = cleanReply(parsed);
  if (!reply) {
    send(res, 502, { error: 'invalid_reply', message: 'The AI service returned an unusable draft.' });
    return;
  }
  send(res, 200, reply);
}
