import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import PreviewWindow from './PreviewWindow';
import '@fontsource-variable/material-symbols-outlined';
import './globals.css';

const isPreviewWindow = new URLSearchParams(window.location.search).get('window') === 'preview';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isPreviewWindow ? <PreviewWindow /> : <App />}
  </React.StrictMode>,
);
