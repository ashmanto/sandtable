# Contributing to Sandtable

Thanks for your interest. Bug reports, fixes, and small features are welcome. For a larger
change, open an issue first so you can agree on the approach before you write code.

## Open an issue

On the [Issues](https://github.com/ashmanto/sandtable/issues) page, click **New issue** and pick
**Bug report** or **Feature request**. The bug report form asks for your Sandtable and macOS
versions and your ticket source, which a fix usually needs. To report a security problem, follow
[SECURITY.md](SECURITY.md) instead of opening a public issue.

## Set up

You need the tools in the README's [Requirements](README.md#requirements). Then:

```bash
npm install    # also rebuilds node-pty for Electron and turns on the pre-push hook
npm run dev -- -- --user-data-dir="$(mktemp -d)"
```

The temporary `--user-data-dir` keeps a development run away from the data folder of an
installed Sandtable. A development run still starts real tmux sessions and creates real worktrees
when you click **Start**, so use a throwaway project.

## Make a change

1. Work on a feature branch.
2. Write the failing test first, watch it fail, then make it pass.
3. Keep `docs/features.md`, the README, and `DESIGN.md` in step with the change.
4. Run the checks. The pre-push hook runs them too:

   ```bash
   npm run lint && npm run typecheck && npm test && npm run format:check
   npm run build && npx playwright test
   ```

5. Open a pull request that says why the change is needed and how you tested it. It can merge
   only after the `ci` workflow passes, and that workflow also builds the packaged app and runs its
   tests.

`CLAUDE.md` holds the architecture, the invariants that every change must keep, and the code
style. Read it before your first change. `.claude/docs/workflow.md` covers commit messages.

## Release a version

The `release` workflow builds the DMG on a GitHub-hosted Apple silicon runner. It doesn't use a
local build. To release a version, follow these steps:

1. On a branch, set `version` in `package.json` to the version to release, such as `1.2.0`. Merge
   the change to `master`.
2. Create a release on GitHub with a tag of `v` and that version, such as `v1.2.0`, on `master`,
   and publish it.

   The workflow stops if the tag doesn't match `package.json`. It runs lint and the unit tests,
   then the end-to-end tests against the packaged app, including the check that the app bundles
   only `out/` and `package.json`. A failure stops it before the upload.

3. The workflow attaches `Sandtable-<version>-arm64.dmg` to the release and opens a pull request
   in `ashmanto/homebrew-tap` with the cask's `version` and `sha256`. Merge that pull request.
4. Check the cask:

   ```bash
   brew update && brew audit --cask --online --strict ashmanto/tap/sandtable
   ```

The workflow writes to the tap with the `HOMEBREW_TAP_TOKEN` repository secret: a fine-grained
personal access token for `ashmanto/homebrew-tap` alone, with read and write access to
**Contents** and **Pull requests**. When the token expires, the tap step fails, so replace the
secret and run the failed job again.

The app is signed ad hoc and isn't notarized.

## License

By contributing, you agree that your contributions are licensed under the
[Functional Source License, Version 1.1, MIT Future License](LICENSE.md).
