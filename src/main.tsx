import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Dashboard } from './ui/Dashboard.tsx';
import { sampleRequest } from './sample.ts';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Dashboard request={sampleRequest} />
  </StrictMode>,
);
