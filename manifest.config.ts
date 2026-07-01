import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'notebooklmkit',
  version: '0.1.0',
  description: 'Bulk multi-select delete for NotebookLM notebooks.',
  host_permissions: ['https://notebooklm.google.com/*'],
  content_scripts: [
    {
      matches: ['https://notebooklm.google.com/*'],
      js: ['src/content/main.ts'],
      run_at: 'document_idle',
    },
  ],
})
