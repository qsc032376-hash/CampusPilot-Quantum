import { useState } from 'react';
import './assistant.css';

export function AssistantPanel() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="cp-ai__launcher"
        data-tour="assistant"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
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

          <p className="cp-ai__preview-note" role="status">
            UI preview only. The AI is not connected, your messages are not sent, and no schedule changes are made.
          </p>

          <ol className="cp-ai__messages" aria-label="Assistant chat preview">
            <li className="cp-ai__message">
              The scheduling assistant chat will appear here when the feature is connected.
            </li>
          </ol>

          <div className="cp-ai__composer">
            <label className="cp-ai__label" htmlFor="cp-ai-input">
              Chat preview
            </label>
            <textarea
              id="cp-ai-input"
              className="cp-ai__input"
              rows={3}
              disabled
              placeholder="Messaging is not available in this preview"
            />
            <button type="button" className="cp-ai__send" disabled>
              Send
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
