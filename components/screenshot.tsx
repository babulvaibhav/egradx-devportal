/**
 * A screenshot of OIM, in the reader's colour scheme. The images are captured by OIM's browser tests
 * (apps/egradx-oim/e2e, docsScreenshot) and copied into public/screens/ by scripts/import-screens.mjs, never made by hand:
 *
 *   <Screenshot name="oim-audit-trail" alt="OIM's audit trail" />
 */
export function Screenshot({ name, alt, caption }: { name: string; alt: string; caption?: string }) {
  return (
    <figure className="not-prose my-6">
      {/* eslint-disable-next-line @next/next/no-img-element -- a static export serves the files as they are */}
      <img src={`/screens/${name}-light.png`} alt={alt} className="w-full rounded-xl border dark:hidden" loading="lazy" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/screens/${name}-dark.png`} alt={alt} className="hidden w-full rounded-xl border dark:block" loading="lazy" />
      {caption ? <figcaption className="mt-2 text-sm text-fd-muted-foreground">{caption}</figcaption> : null}
    </figure>
  );
}
