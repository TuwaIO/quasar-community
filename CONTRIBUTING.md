# Contributing

Thanks for your interest in Quasar Community Edition.

## How changes reach this repository

This repository is a **generated snapshot**. Nothing is committed to it by
hand — every commit arrives from an automated publication job, and branch
protection blocks direct pushes for everyone including maintainers.

That has one consequence worth stating plainly, because it otherwise looks
like a bug: **an approved pull request cannot be merged with the merge
button.** The button will not work for us either.

## What to do instead

1. **Open the pull request here anyway.** Review happens in this repository —
   that is where the discussion, the diff and the history belong.
2. Once it is approved, a maintainer replays the change onto the upstream
   source (`git cherry-pick` / `git format-patch`).
3. The next publication run brings it back here as part of the regular
   snapshot, and your pull request is closed with a reference to the commit
   that carries your change.

Authorship is preserved: the replay keeps your commit author, so the change
lands under your name.

## Issues

Bug reports and feature requests are welcome as issues. Please include the
release you are on (the `version` in the root `package.json`, which matches
a `vX.Y.Z` tag here), the compose profile you are running
(`docker-compose.minimal.yml` or the full production stack), and the relevant
container logs.

## Local development

See [docs/QUICKSTART_LOCAL.md](./docs/QUICKSTART_LOCAL.md) to get a node
running, and [docs/SEEDING.md](./docs/SEEDING.md) for what the seed does.
