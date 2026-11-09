// Offline build only: expose the in-page server before main.js boots.
import { LocalNet } from './localnet.js';
window.PolarityLocalNet = LocalNet;
document.documentElement.classList.add('offline');
const create = document.getElementById('btnCreate');
if (create) create.textContent = 'Custom match';
