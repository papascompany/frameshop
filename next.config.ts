import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: import.meta.dirname,
  },
  images: {
    // Whitelist Supabase Storage public-object hostnames.
    // Wildcard `*.supabase.co` covers both the project ref subdomain
    // (e.g. `abcdefgh.supabase.co`) and any custom regional hosts, while
    // still rejecting unrelated origins. The pathname is pinned to the
    // public-object route so signed/private URLs aren't proxied.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
    // Be explicit about output formats. Next 16 still defaults to
    // `['image/webp']`, but AVIF gives ~20% better compression for
    // gallery/banner hero shots so we opt in here.
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
