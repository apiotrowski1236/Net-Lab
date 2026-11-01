import { render } from 'preact';
import { App, restoreLastRoute } from './app';
import { loadConfig } from './store/profile';
import { flush } from './store/outbox';
import { storageAvailable } from './store/storage';
import './styles.css';
import './features.css';

restoreLastRoute();
render(<App />, document.getElementById('app')!);

if (!storageAvailable()) {
  alert('This browser is blocking storage, so NetLab cannot save your work. Ask your teacher for help before you start.');
}

void loadConfig().then(() => flush());

// Ask the browser not to clear NetLab's storage when space runs low. Safari also
// clears storage for sites not visited in 7 days unless the site is installed
// to the home screen; this request doesn't change that, so students should
// submit or download before they leave a lab unfinished for a week.
void navigator.storage?.persist?.().catch(() => {});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Offline mode unavailable', e));
  });
}
