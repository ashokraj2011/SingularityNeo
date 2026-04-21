/**
 * One-time Monaco bootstrap for Vite.
 *
 * `@monaco-editor/react` defaults to loading monaco + its web workers
 * from a CDN. That fails in our desktop shell (offline) and adds a
 * TLS round-trip on first render in the browser build. Instead we:
 *
 *   1. Import the locally-installed `monaco-editor` package and hand
 *      it to `loader.config` so the React wrapper stops reaching out
 *      to the CDN.
 *   2. Register `editor.worker` via Vite's `?worker` import so the
 *      editor's core worker is bundled with the app. The specialised
 *      language workers (ts/html/css/json) are intentionally NOT
 *      registered yet — they roughly double the bundle and we don't
 *      need IntelliSense for a read-only diff view.
 *
 * Import this module once from a top-level component (e.g. the first
 * place that renders Monaco) before the editor mounts. Re-importing
 * is a no-op thanks to the module-level guard.
 */
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
// eslint-disable-next-line import/no-unresolved
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

let bootstrapped = false;

export const bootstrapMonaco = () => {
  if (bootstrapped) return;
  bootstrapped = true;

  // Avoid the window check on SSR: this module is only ever imported
  // from React components, which only run client-side, but guard
  // anyway so tooling like vitest doesn't trip.
  if (typeof window !== 'undefined') {
    (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
      getWorker: (_workerId: string, _label: string) => new EditorWorker(),
    };
  }
  loader.config({ monaco });
};
