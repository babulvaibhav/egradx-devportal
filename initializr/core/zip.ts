import JSZip from 'jszip';
import type { GeneratedFile } from './types.ts';

/**
 * The project as a zip, in a folder named after it, as start.spring.io does. Scripts keep their executable bit. `pack`,
 * when given, is the AI context pack's zip: its egradx-sdk-docs/ folder goes into the project as it is.
 */
export async function zipProject(folder: string, files: GeneratedFile[], pack?: ArrayBuffer): Promise<Uint8Array> {
  const zip = new JSZip();
  const root = zip.folder(folder)!;
  for (const file of files) {
    root.file(file.path, file.content, {
      unixPermissions: file.executable ? 0o755 : 0o644,
      date: new Date('2026-01-01T00:00:00Z'),
    });
  }
  if (pack) {
    const docs = await JSZip.loadAsync(pack);
    for (const entry of Object.values(docs.files)) {
      if (entry.dir) continue;
      root.file(entry.name, await entry.async('uint8array'), { unixPermissions: 0o644, date: new Date('2026-01-01T00:00:00Z') });
    }
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', platform: 'UNIX' });
}
