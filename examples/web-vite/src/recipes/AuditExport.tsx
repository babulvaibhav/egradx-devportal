import { Can, useAuditExport } from '@babulvaibhav/egradx-react';

// docs:region audit-export
/**
 * The organization's audit trail as CSV, with the same filters as the list. The download needs the access token, so a
 * plain link won't do: the hook fetches it, then the page saves it.
 */
export function ExportNotesAudit() {
  const exporter = useAuditExport();
  async function download() {
    const { blob, filename, truncated } = await exporter.run({ category: ['notes'] });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement('a'), { href: url, download: filename });
    link.click();
    URL.revokeObjectURL(url);
    if (truncated) alert('The export stopped at its row limit: narrow the filters.');
  }
  return (
    <Can authority="egradx.audit.read">
      <button disabled={exporter.pending} onClick={() => void download()}>Export the notes' audit trail</button>
    </Can>
  );
}
// docs:end
