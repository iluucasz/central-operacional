FROM node:22-bookworm-slim

WORKDIR /app

# node_modules lives at /app so both /app/lib (shared with the Next.js app) and /app/worker can
# resolve dependencies via Node's normal upward node_modules lookup.
COPY worker/package.json ./package.json
RUN npm install

COPY lib ./lib
COPY worker ./worker

# Real Chromium binary for playwright-core's local-dev path (see lib/porto-integration/browser.ts)
# — the VPS isn't a serverless runtime, so @sparticuz/chromium's binary is never used here.
RUN npx playwright install --with-deps chromium

# Compiled with the real TypeScript compiler, not run live through tsx/esbuild — confirmed live
# that esbuild's transform injects a `__name(...)` helper call into functions that
# frame.evaluate()/page.evaluate() then ship into the browser as raw source text via .toString(),
# where that helper doesn't exist ("ReferenceError: __name is not defined"). tsc doesn't do this.
RUN npx tsc -p worker/tsconfig.json

CMD ["node", "dist/worker/index.js"]
