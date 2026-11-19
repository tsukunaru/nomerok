import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import cssVars from 'css-vars-ponyfill';
import App from './App.tsx';
import './styles/global.css';

cssVars({ onlyLegacy: true, updateURLs: false, watch: false });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
