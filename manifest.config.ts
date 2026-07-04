import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'notebooklmkit',
  version: '0.1.0',
  description: 'Bulk delete notebooks and bulk import URLs/tabs for NotebookLM.',
  host_permissions: ['https://notebooklm.google.com/*'],
  // tabs は F2-1（開いているタブの一括インポート）でタブの URL / title を読むためだけに使用。
  // storage は F2-2（現ページから新規ノートブック作成）で pendingCreate を保持するためだけに使用。
  // alarms は F2-2 の '…' 固着ウォッチドッグ（MV3 SW のアイドル終了に耐える）に使用。
  // scripting は F2-2 の音声解説自動押下で、生成タイル（Angular Material の div[role=button]）を
  // ページの主ワールドで実クリックするためだけに使用（隔離ワールドの合成イベントは効かない。§8.7）。
  // 対象は host_permissions（notebooklm.google.com）に限定。取得したデータは端末内で完結し外部送信しない（§3.3）。
  permissions: ['tabs', 'storage', 'alarms', 'scripting'],
  // ツールバーアイコンからの新規ノートブック作成（F2-2）。default_popup を置かず onClicked を使う。
  action: {},
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
