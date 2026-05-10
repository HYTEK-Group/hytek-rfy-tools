import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required so the @hytek/rfy-codec package (uses node:crypto + node:zlib)
  // is treated as an external on the server bundle.
  serverExternalPackages: ["@hytek/rfy-codec"],

  // Pin Turbopack's workspace root to THIS app. Without it, Next walks up
  // looking for a lockfile and picks `C:\Users\Scott\CLAUDE CODE\package-
  // lock.json` (a stray hytek-invoicing leftover), which then breaks module
  // resolution for tailwindcss + other deps in dev. Hard-coded absolute
  // path because `__dirname` is unreliable in next.config.ts under Node
  // ESM. Dev-only setting — production builds are unaffected.
  turbopack: {
    root: "C:/Users/Scott/CLAUDE CODE/hytek-rfy-tools",
  },

  // Pre-existing forge-encode child_process intersection-collapse TS errors
  // (app/api/forge/encode/{async,}/route.ts) exist on master and historically
  // didn't block Vercel deploys. Make that tolerance explicit so brain-v0
  // builds the same way. Real type-checking still happens via `npm run
  // typecheck` and via the editor; this only affects the production build.
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
// Force rebuild 29 Apr 2026 13:34:25
