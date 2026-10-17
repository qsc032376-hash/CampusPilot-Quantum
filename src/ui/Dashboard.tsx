import { useState } from 'react';
import type { ScheduleRequest, ScheduleResponse } from '../types.ts';
import { generateMockSchedule } from '../scheduler.ts';
import { AppHeader } from './components/AppHeader.tsx';
import { TaskForm } from './components/TaskForm.tsx';
import type { TaskDraft } from './components/TaskForm.tsx';
import { WeeklySchedule } from './components/WeeklySchedule.tsx';
import { ScheduleResults } from './components/ScheduleResults.tsx';
import { LocationCard } from './components/LocationCard.tsx';
import './ui.css';

interface DashboardProps {
  request: ScheduleRequest;
}

let idCounter = 0;
function makeTaskId(): string {
  idCounter += 1;
  return `task-${Date.now().toString(36)}-${idCounter}`;
}

/**
 * Dashboard composition root. Owns the editable request and the scheduler
 * result; every scheduling decision is delegated to generateMockSchedule.
 */
export function Dashboard({ request: initialRequest }: DashboardProps) {
  const [request, setRequest] = useState<ScheduleRequest>(initialRequest);
  const [result, setResult] = useState<ScheduleResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function build(next: ScheduleRequest): void {
    try {
      setResult(generateMockSchedule(next));
      setMessage(null);
    } catch (error) {
      setResult(null);
      setMessage(error instanceof Error ? error.message : 'The schedule could not be built.');
    }
  }

  /** Applies a request change and keeps an already-built plan in sync. */
  function applyRequest(next: ScheduleRequest): void {
    setRequest(next);
    if (result) build(next);
  }

  function handleBuild(): void {
    build(request);
  }

  function handleAddTask(draft: TaskDraft): void {
    applyRequest({
      ...request,
      tasks: [...request.tasks, { id: makeTaskId(), ...draft }],
    });
  }

  function handleRemoveTask(id: string): void {
    applyRequest({ ...request, tasks: request.tasks.filter((task) => task.id !== id) });
    setSelectedId((current) => (current === `study-${id}` ? null : current));
  }

  function handleReset(): void {
    setRequest(initialRequest);
    setResult(null);
    setMessage(null);
    setSelectedId(null);
  }

  const selectedBlock = result?.blocks.find((block) => block.id === selectedId) ?? null;

  return (
    <div className="cp-app">
      <AppHeader request={request} result={result} onReset={handleReset} />

      <main className="cp-main">
        <div className="cp-column">
          <TaskForm request={request} onAdd={handleAddTask} onRemove={handleRemoveTask} />
          <LocationCard block={selectedBlock} request={request} />
        </div>

        <WeeklySchedule request={request} result={result} selectedId={selectedId} onSelect={setSelectedId} />

        <div className="cp-column">
          <ScheduleResults
            request={request}
            result={result}
            message={message}
            onBuild={handleBuild}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
      </main>

      <footer className="cp-foot">
        Student-built prototype · Data is in memory and resets on reload · Availability is not verified
      </footer>
    </div>
  );
}
