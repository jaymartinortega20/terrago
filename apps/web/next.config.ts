import type { NextConfig } from 'next';

const gameServer = process.env.NEXT_PUBLIC_GAME_SERVER_URL ?? 'http://localhost:4000';
const wsServer = gameServer.replace(/^http/, 'ws');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@terrago/shared', '@terrago/game-data'],
  // The REST API is served through this site so the login cookie is first-party.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${gameServer}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // blob:/data: — HD sprite baking: model textures load through blob URLs.
              `connect-src 'self' blob: data: ${gameServer} ${wsServer}`,
              "img-src 'self' data: blob:",
              "style-src 'self' 'unsafe-inline'",
              // Next.js injects inline bootstrap scripts; Phaser needs eval-free WebGL only.
              // wasm-unsafe-eval: the model decoder used to bake HD sprites (meshopt) is WebAssembly.
              `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
              "font-src 'self' data:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
