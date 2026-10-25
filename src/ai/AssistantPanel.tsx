import { useRef, useState } from 'react';
import { askAssistant } from './assistantClient.ts';
import type { AssistantMessage } from './assistantClient.ts';
import { previewDraft } from './assistantDraft.ts';
import type { DraftPreview } from './assistantDraft.ts';
import type { TaskDraft } from '../ui/taskValidation.ts';
import './assistant.css';

interface AssistantPanelProps {
  /** Only called after the user confirms the previewed tasks. */
  onApply: (drafts: TaskDraft[]) => void;
  today: string;
  windowStart: string;
  locationNames: string[];
}

type Phase = 'idle' | 'sending' | 'question' | 'draft' | 'unconfigured' | 'error';

export function AssistantPanel({ onApply, today, windowStart, locationNames }: AssistantPanelProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [preview, setPreview] = useState<DraftPreview | null>(null);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  async function send() {
    const text = input.trim();
    if (!text || phase === 'sending') return;
    const next: AssistantMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setPhase('sending');
    setPreview(null);
    setQuestion('');
    setError('');
    const result = await askAssistant(next, { today, locationNames });
    if (result.status === 'unconfigured') {
      setPhase('unconfigured');
      return;
    }
    if (result.status === 'error') {
      setError(result.message);
      setPhase('error');
      return;
    }
    if (result.reply.kind === 'question') {
      setQuestion(result.reply.question);
      setMessages([...next, { role: 'assistant', content: result.reply.question }]);
      setPhase('question');
      return;
    }
    const previewed = previewDraft(result.reply.tasks, windowStart);
    setPreview({ ...previewed, notes: result.reply.notes });
    setNotes(result.reply.notes);
    setMessages([...next, { role: 'assistant', content: 'Here is what I would add. Check it before confirming.' }]);
    setPhase('draft');
  }

  function confirm() {
    if (!preview) return;
    const drafts = preview.items.filter((item) => item.ok).map((item) => item.draft);
    if (drafts.length === 0) return;
    onApply(drafts);
    setPreview(null);
    setMessages([...messages, { role: 'assistant', content: `Added ${drafts.length} task(s). Build the plan yourself when ready.` }]);
    setPhase('idle');
  }

  return (
    <>
      <button
        type="button"
        className="cp-ai__launcher"
        data-tour="assistant"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          window.setTimeout(() => inputRef.current?.focus(), 40);
        }}
      >
        <span aria-hidden="true">✦</span> AI assistant
      </button>

      {open ? (
        <section className="cp-ai__panel" role="dialog" aria-label="AI scheduling assistant" data-tour="assistant-panel">
          <header className="cp-ai__head">
            <h2>AI scheduling assistant</h2>
            <button type="button" className="cp-ai__close" onClick={() => setOpen(false)} aria-label="Close the assistant">
              ×
            </button>
          </header>

          <p className="cp-ai__disclosure">
            Your message and the current schedule context are sent to the configured AI service. Nothing is stored on the
            server and no task is created until you confirm.
          </p>

          {phase === 'unconfigured' ? (
            <p className="cp-ai__state cp-ai__state--warn" role="status">
              AI 助手尚未配置 / The AI assistant is not configured on this deployment.
            </p>
          ) : null}
          {phase === 'error' ? <p className="cp-ai__state cp-ai__state--warn" role="status">{error}</p> : null}

          <ol className="cp-ai__messages">
            {messages.map((message, index) => (
              <li key={index} className={`cp-ai__message cp-ai__message--${message.role}`}>
                {message.content}
              </li>
            ))}
            {phase === 'sending' ? <li className="cp-ai__message">Thinking…</li> : null}
          </ol>

          {phase === 'question' ? <p className="cp-ai__question">{question}</p> : null}

          {preview ? (
            <div className="cp-ai__draft" data-tour="assistant-draft">
              <p className="cp-ai__draft-title">These tasks will be added when you confirm:</p>
              <ul>
                {preview.items.map((item, index) => (
                  <li key={index} className={item.ok ? 'cp-ai__ok' : 'cp-ai__bad'}>
                    {item.ok
                      ? `${item.draft.title} · ${item.draft.durationMinutes} min · due ${new Date(item.draft.dueAt).toLocaleString('en-US', { timeZone: 'America/New_York' })}`
                      : `${item.title}: ${item.message}`}
                  </li>
                ))}
              </ul>
              {notes.length > 0 ? (
                <ul className="cp-ai__notes">
                  {notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}
              <div className="cp-ai__actions">
                <button type="button" className="cp-ai__cancel" onClick={() => setPreview(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="cp-ai__confirm"
                  onClick={confirm}
                  disabled={preview.validCount === 0}
                >
                  Add {preview.validCount} task{preview.validCount === 1 ? '' : 's'}
                </button>
              </div>
            </div>
          ) : null}

          <div className="cp-ai__composer">
            <label className="cp-ai__label" htmlFor="cp-ai-input">
              Describe the work and its deadline
            </label>
            <textarea
              id="cp-ai-input"
              ref={inputRef}
              className="cp-ai__input"
              rows={3}
              value={input}
              placeholder="Two hours of calculus review before Thursday night"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button type="button" className="cp-ai__send" onClick={() => void send()} disabled={phase === 'sending'}>
              Send
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
