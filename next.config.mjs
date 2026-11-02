import { createMDX } from 'fumadocs-mdx/next';

// The generated API references are large (reference/node/egradx-sdk.md alone holds every export of the SDK), and the
// MDX loader's Node processes run out of the default heap on them. They inherit NODE_OPTIONS, so give them room here,
// unless the caller already chose a size.
if (!/--max-old-space-size/.test(process.env.NODE_OPTIONS ?? '')) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=6144`.trim();
}

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  reactStrictMode: true,
};

export default withMDX(config);
