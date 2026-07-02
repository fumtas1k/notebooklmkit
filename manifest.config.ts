import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'notebooklmkit',
  version: '0.1.0',
  description: 'Bulk delete notebooks and bulk import URLs/tabs for NotebookLM.',
  host_permissions: ['https://notebooklm.google.com/*'],
  // tabs は F2-1（開いているタブの一括インポート）でタブの URL / title を読むためだけに使用。
  // 取得したデータは端末内で完結し、外部送信はしない（docs/requirements.md §3.3）。
  permissions: ['tabs'],
  background: {
    service_worker: 'src/background/main.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://notebooklm.google.com/*'],
      js: ['src/content/main.ts'],
      run_at: 'document_idle',
    },
  ],
})
