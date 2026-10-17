import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ScheduleResponse } from './types.ts';
import { generateMockSchedule } from './scheduler.ts';
import { sampleRequest } from './sample.ts';
import './style.css';

const time = (value: string) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
}).format(new Date(value));

function App() {
  const [schedule, setSchedule] = useState<ScheduleResponse | null>(null);
  return <main>
    <header><span className="brand">CP / CAMPUSPILOT</span><span>Hackathon prototype</span></header>
    <section className="intro">
      <p className="eyebrow">LESS PLANNING. MORE PROGRESS.</p>
      <h1>Make room for<br />your next study session.</h1>
      <p>A simple study planner for Ohio State students. Try a sample day to find study time around classes and other commitments.</p>
      <button onClick={() => setSchedule(generateMockSchedule(sampleRequest))}>Generate sample schedule <span aria-hidden="true">→</span></button>
      <p className="note">Deterministic demo · No account or AI service required</p>
    </section>
    <div className="columns">
      <section className="panel">
        <p className="eyebrow">THE SAMPLE DAY</p><h2>Monday, October 19, 2026</h2>
        <p>9:00 AM–5:00 PM · Columbus time (America/New_York)</p>
        <h3>Already on your calendar</h3>
        {[...sampleRequest.classes, ...sampleRequest.unavailablePeriods].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).map(event => <div className="row" key={event.id}><strong>{event.title}</strong><span>{time(event.start)}–{time(event.end)}</span></div>)}
        <h3>Study tasks</h3>
        {sampleRequest.tasks.map(task => <div className="row" key={task.id}><strong>{task.title}</strong><span>{task.durationMinutes} min · Due {time(task.dueAt)}</span></div>)}
      </section>
      <section className="panel" aria-live="polite" aria-atomic="true">
        <p className="eyebrow">YOUR STUDY PLAN</p><h2>{schedule ? `${schedule.blocks.length} study sessions ready` : 'Your free time, put to work.'}</h2>
        {!schedule && <p>Generate the sample schedule to see study sessions here. Repeating it gives the same result.</p>}
        {schedule?.blocks.map(block => <article className="block" key={block.id}><p className="slot">{time(block.start)}–{time(block.end)}</p><h3>{block.title}</h3><p>{sampleRequest.locations.find(location => location.id === block.locationId)?.name}</p></article>)}
        {!!schedule?.unscheduledTasks.length && <div className="unscheduled"><h3>Needs another time</h3>{schedule.unscheduledTasks.map(item => <p key={item.taskId}><strong>{sampleRequest.tasks.find(task => task.id === item.taskId)?.title}</strong><br />{item.reason}</p>)}</div>}
      </section>
    </div>
    <footer>Student-built prototype. Location is a sample suggestion; availability is not checked.</footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
