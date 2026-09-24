import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App.jsx';
import { loadRuleSettings } from './hooks/useRuleSettings';

// Start fetching the rule tunables now, so a game dealt a moment later plays by
// the served values (every game falls back to identical defaults until then).
loadRuleSettings();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
