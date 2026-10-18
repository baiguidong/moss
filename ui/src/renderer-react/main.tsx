import { initializeHostClient } from './web-bootstrap';

const start = !window.agentDesktop && new URLSearchParams(location.search).get('window') === 'cloud-environment'
  ? import('./cloud-environment').then(module => module.mountCloudEnvironment())
  : initializeHostClient().then(() => import('./mount'));
start.catch(error => {
  document.getElementById('root')!.textContent = `无法连接 Moss：${error.message}`;
});
