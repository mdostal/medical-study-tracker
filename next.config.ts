import type { NextConfig } from "next";

/**
 * Mounted at tools.mdostal.com/study-tracker via a multi-zone rewrite in the
 * mdostal-tools-hub repo (same pattern as allergy-locator, mapstack-us,
 * drone-hub). basePath makes every internal link, redirect, and /_next/*
 * asset request this app emits already carry the /study-tracker prefix, so
 * the hub's rewrite (which forwards that same prefixed path straight
 * through) just works. The standalone Vercel URL
 * (medical-study-tracker-seven.vercel.app) moves under this same prefix too
 * — root now redirects there rather than 404ing, so the bare URL stays a
 * usable link on its own, not just as a hub-mount internal.
 */
const nextConfig: NextConfig = {
  basePath: "/study-tracker",
  async redirects() {
    // basePath:false bypasses the automatic /study-tracker prefixing for
    // this one rule, so it matches the true bare root — otherwise Next
    // would only ever match /study-tracker/ itself, and the true root
    // would 404 instead of forwarding anywhere.
    return [{ source: "/", destination: "/study-tracker", basePath: false, permanent: false }];
  },
};

export default nextConfig;
