import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import PreviewWindow from './PreviewWindow';
import '@fontsource-variable/material-symbols-outlined';
import './globals.css';

const isPreviewWindow = new URLSearchParams(window.location.search).get('window') === 'preview';
const isTerminalWindow = new URLSearchParams(window.location.search).get('window') === 'terminal';
const TerminalWindow = React.lazy(() => import('./TerminalWindow'));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isTerminalWindow ? <React.Suspense><TerminalWindow /></React.Suspense> : isPreviewWindow ? <PreviewWindow /> : <App />}
  </React.StrictMode>,
);
