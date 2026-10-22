import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error(`Expected a version like 1.2.3, got "${version}"`);

const server = "apps/server/package.json";
writeFileSync(server, readFileSync(server, "utf8").replace(/"version": "[^"]*"/, `"version": "${version}"`));
const chart = "charts/flitz/Chart.yaml";
writeFileSync(
  chart,
  readFileSync(chart, "utf8")
    .replace(/^version: .*$/m, `version: ${version}`)
    .replace(/^appVersion: .*$/m, `appVersion: "${version}"`),
);
