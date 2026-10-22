import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Dashboard } from './ui/Dashboard.tsx';
import { createRuntimeSampleRequest } from './ui/sampleRuntime.ts';
import './style.css';

// One clock reading keeps the demo range and the example data on the same day.
const startup = new Date();
const exampleRequest = createRuntimeSampleRequest(startup);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Dashboard request={exampleRequest} now={() => startup} />
  </StrictMode>,
);
