// Workflows: "when this happens, do these steps", set up by a business without code.
// The screen grows from here: the flows as cards, the builder, the run log, and running a flow by hand or from a photo.

import { data } from './api.js';

export function mount(el) {
  const root = document.createElement('div');
  root.className = 'workspace flows';
  root.innerHTML = '<div class="workspace-inner"><h1 class="reveal">Workflows</h1></div>';
  el.appendChild(root);
  const off = data.on(() => {});
  return () => { off(); root.remove(); };
}
