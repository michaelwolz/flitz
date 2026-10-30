ARG NODE_IMAGE=node:24-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
COPY apps/server/package.json apps/server/
COPY packages/db/package.json packages/db/
RUN npm install -g "$(node -p 'require("./package.json").packageManager')" \
  && pnpm install --prod --frozen-lockfile

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS web
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
COPY apps/web/package.json apps/web/
RUN npm install -g "$(node -p 'require("./package.json").packageManager')" \
  && pnpm install --frozen-lockfile --filter @flitzlink/web
COPY apps/web apps/web
COPY docs/brand/favicon.svg docs/brand/flitz-lockup-dark.svg docs/brand/flitz-lockup-light.svg docs/brand/
COPY apps/server/src/scopes.ts apps/server/src/
RUN pnpm --filter @flitzlink/web build

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS geoip
WORKDIR /geoip
RUN node --input-type=module <<'EOF'
import { writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
const now = new Date();
for (const month of [now, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1))]) {
  const name = `dbip-country-lite-${month.toISOString().slice(0, 7)}.mmdb.gz`;
  const response = await fetch(`https://download.db-ip.com/free/${name}`);
  if (!response.ok) continue;
  writeFileSync("dbip-country-lite.mmdb", gunzipSync(await response.arrayBuffer()));
  writeFileSync(
    "NOTICE",
    `IP geolocation by DB-IP (https://db-ip.com): ${name}, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).\n`,
  );
  process.exit(0);
}
throw new Error("No DB-IP Lite country database found for this or last month");
EOF

FROM ${NODE_IMAGE}
WORKDIR /app
COPY --from=deps /app ./
COPY --from=geoip /geoip geoip
COPY --from=web /app/apps/web/dist apps/web/dist
COPY apps/server/src apps/server/src
COPY apps/server/docs apps/server/docs
COPY packages/db/src packages/db/src
COPY packages/db/schema.sql packages/db/schema.sql
COPY docs/brand/flitz-qr-centre.svg docs/brand/flitz-lockup-light.svg docs/brand/flitz-lockup-light.png docs/brand/
COPY LICENSE NOTICE ./
ENV NODE_ENV=production
ENV GEOIP_DATABASE=/app/geoip/dbip-country-lite.mmdb
USER node
EXPOSE 3000
ENTRYPOINT ["node", "apps/server/src/main.ts"]
CMD ["server"]
