import { initializeHostClient } from './web-bootstrap';

initializeHostClient().then(() => import('./mount')).catch(error => {
  document.getElementById('root')!.textContent = `无法连接 Moss：${error.message}`;
});
