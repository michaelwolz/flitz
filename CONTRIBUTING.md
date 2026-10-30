# Contributing to flitz

Bug reports, ideas and pull requests are welcome on [michaelwolz/flitz](https://github.com/michaelwolz/flitz). Report security problems privately, as [SECURITY.md](SECURITY.md) describes.

## Sign off your commits

flitz is licensed under the [Apache-2.0](LICENSE), and contributions come in under the same license. Instead of a contributor license agreement, every commit carries a sign-off under the [Developer Certificate of Origin](https://developercertificate.org): with it, you certify that you wrote the change or otherwise have the right to submit it under the project's license. Sign off with `git commit -s`, which adds a line with the name and email of your Git configuration:

```
Signed-off-by: Ada Lovelace <ada@example.com>
```

To sign off commits you already made, run `git rebase --signoff main` and push again.

## Development

You need Node 24, pnpm (the version is pinned in `package.json`) and Docker, since the tests start Postgres with Testcontainers.

```sh
pnpm install
pnpm typecheck
pnpm lint                              # oxlint
pnpm format                            # oxfmt (pnpm format:check only checks)
pnpm test                              # server tests
pnpm build                             # the web app
pnpm --filter @flitzlink/site build    # the website
pnpm --filter @flitzlink/web exec playwright install chromium
pnpm e2e                               # builds the web app and runs Playwright
```

`pnpm install` also sets up a pre-commit hook that formats the staged files with oxfmt and lints them with oxlint. CI runs these (the e2e run builds the web app), builds the Docker image and lints the Helm chart. To try a change end to end, run `docker compose up --build`.

To update dependencies, run `pnpm dlx npm-check-updates -u` and then `pnpm install`. `.ncurc.json` gives it a 7-day cooldown, so it only picks versions published at least 7 days ago, and keeps `@types/node` on the Node major the image runs and `ua-parser-js` on v1 (v2 is AGPL). pnpm rejects every package younger than 7 days, transitive ones included (`minimumReleaseAge` in `pnpm-workspace.yaml`): if a range needs a younger version, lower it to the newest one old enough, and if pnpm rejects the lockfile, re-resolve it with `pnpm clean --lockfile` and `pnpm install`.

Read [AGENTS.md](AGENTS.md) before you change code: its rules apply to people and agents alike. The words flitz uses are defined in [GLOSSARY.md](GLOSSARY.md).

## Commit messages

Every commit message follows [Conventional Commits](https://www.conventionalcommits.org): `type(scope): summary`, for example `feat(server): add link tags` or `fix(web): keep the next page after sign-in`. Use `feat` for features, `fix` for bug fixes, and `docs`, `refactor`, `test`, `ci`, `build`, `chore` or `perf` for the rest; mark a breaking change with `!` after the type or a `BREAKING CHANGE:` footer. `pnpm install` sets up a commit-msg hook (lefthook) that checks each message with commitlint, and CI checks every commit of a push or pull request the same way.

## Releases

Releases are automatic via semantic-release (see `.releaserc.json`): after CI passes on `main`, `fix` commits release a patch, `feat` a minor and breaking changes a major version. Other types release nothing. The release workflow creates a draft GitHub release, publishes the image and chart, then publishes the release. If artifact publishing fails after a tag is created, run the Release workflow manually with that version (without the `v` prefix) to resume from its tag.
