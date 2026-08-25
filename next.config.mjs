/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  serverExternalPackages: ['playwright-core', '@sparticuz/chromium'],
  // playwright-core is marked external above (needs to stay unbundled for its native binary),
  // but that means Next's output file tracing has to be told explicitly to copy its non-code
  // data files (e.g. browsers.json) into the deployed function — otherwise it's missing at
  // runtime with "Cannot find module '.../playwright-core/browsers.json'".
  outputFileTracingIncludes: {
    '/api/porto-config/test-login': ['./node_modules/playwright-core/**/*', './node_modules/@sparticuz/chromium/**/*'],
    '/api/cron/porto-hours': ['./node_modules/playwright-core/**/*', './node_modules/@sparticuz/chromium/**/*'],
    '/api/cron/porto-schedule': ['./node_modules/playwright-core/**/*', './node_modules/@sparticuz/chromium/**/*'],
  },
}

export default nextConfig
