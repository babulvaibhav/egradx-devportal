/** Everything this application reads from its environment, in one place. */
export const config = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: required('DATABASE_URL'), // postgresql://postgres:postgres@localhost:5432/notes
  keystorePath: process.env.EGRADX_KEYSTORE_PATH ?? './keys',
  keyPassphrase: required('EGRADX_KEY_PASSPHRASE'), // protects the signing keys; keep it secret
  demoPassword: process.env.DEMO_PASSWORD ?? 'demo-password',
  smtp: { host: process.env.SMTP_HOST ?? 'localhost', port: Number(process.env.SMTP_PORT ?? 1025) },
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name} (see .env.example)`);
  }
  return value;
}
