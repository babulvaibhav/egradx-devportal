import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { EgradxProvider } from '@babulvaibhav/egradx-react';
import { App } from './app/App';
import { egradx } from './lib/egradx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Restores the stored session on start, and gives every hook the client. */}
    <EgradxProvider client={egradx}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </EgradxProvider>
  </StrictMode>,
);
