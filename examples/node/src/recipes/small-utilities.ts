// The core utilities a recipe or guide shows (the portal's recipes, type-checked with the Node example). Not part of
// the generated project: kept by scripts/generate-examples.mjs.
import {
  generateRandomString,
  getUnzippedContent,
  getZippedContent,
  openSecretText,
  sealSecretText,
  uuidV7,
} from '@babulvaibhav/egradx-sdk';

// docs:region seal-a-secret
/**
 * A secret kept in one column: AES-256-GCM with a key wrapped under the passphrase, as one string ("v1:…:…:…") that
 * Java, Node and Python all read.
 */
export function seal(apiKey: string, passphrase: string): Promise<string> {
  return sealSecretText(apiKey, passphrase);
}

export function open(sealed: string, passphrase: string): Promise<string> {
  return openSecretText(sealed, passphrase); // a wrong passphrase or a changed value rejects
}
// docs:end

// docs:region small-utilities
export function examples(): void {
  const code = generateRandomString(12); // A–Z, a–z, 0–9, from a secure source
  const id = uuidV7(); // time-ordered: new rows land at the index's end
  const zipped = getZippedContent('a long text'); // gzip
  const text = getUnzippedContent(zipped);
  console.log(code, id, text);
}
// docs:end
