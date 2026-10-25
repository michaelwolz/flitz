import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const releaseRequire = createRequire(require.resolve("semantic-release"));
const { generateNotes } = await import(pathToFileURL(releaseRequire.resolve("@semantic-release/release-notes-generator")).href);
const { preset } = JSON.parse(readFileSync(new URL("../.releaserc.json", import.meta.url), "utf8"));
const notes = await generateNotes(
  { preset },
  {
    cwd: process.cwd(),
    options: { repositoryUrl: "https://github.com/michaelwolz/flitz.git" },
    commits: [{ hash: "a".repeat(40), message: "feat: add a sample link" }],
    lastRelease: { gitTag: "v0.0.0" },
    nextRelease: { version: "0.1.0", gitTag: "v0.1.0" },
  },
);
assert.match(notes, /add a sample link/);
assert.match(notes, /0\.1\.0/);
console.log("Release notes render with the configured preset.");
