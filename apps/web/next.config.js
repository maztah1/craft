/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@craft/types', '@craft/stellar', '@craft/ui'],
  experimental: {
    serverActions: true,
  },
  async headers() {
    return [
      {
        // Apply to all API routes. The runtime corsHeaders() utility enforces
        // the per-origin allow-list; these static headers cover the common
        // non-credentialed fields that are safe to set globally.
        // Webhook routes (/api/webhooks/*) are intentionally included here
        // only for the method/header declarations — origin gating is handled
        // by the runtime utility and Stripe signature verification.
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, PATCH, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization, X-Requested-With' },
          { key: 'Access-Control-Max-Age', value: '86400' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
