# Releasing

A release is a **git tag**. Pushing `v1.32.1` builds the multi-arch image, publishes
`ghcr.io/sseiber/zwave-service:1.32.1` and moves `:latest` onto it. Nothing else moves
`:latest` — not a merge, not a manual build.

## The normal release

From a clean `main`, with the work already merged:

```bash
.scripts/incVersion.sh patch --push
```

That one command bumps all four `package.json` files, refreshes `package-lock.json`,
commits `Release <version>`, creates an annotated `v<version>` tag, and pushes both.
The tag push starts [`publish-image.yml`](../.github/workflows/publish-image.yml).

`patch` | `minor` | `major`, or `--version 2.0.0` to set one outright.

Watch it:

```bash
gh run watch "$(gh run list --workflow=publish-image.yml --limit 1 \
  --json databaseId --jq '.[0].databaseId')"
```

Then confirm both tags landed on one multi-arch index:

```bash
gh api --paginate user/packages/container/zwave-service/versions \
  --jq '.[0]|{tags:.metadata.container.tags}'
```

Both tags should appear on one entry, which is what "moved `:latest`" means here — the
merge job binds the two architecture digests under both tags at once, so `:latest` is
never a separate image that could drift. The v1.32.1 release read:

```
{"created":"2026-11-20T07:50:55Z","tags":["1.32.1","latest"]}
```

and both tags resolved anonymously to the same OCI index,
`sha256:2e4dd60b…`, carrying `linux/amd64` and `linux/arm64`.

## Doing it in stages

The flags stack, so you can stop anywhere and look before going on:

```bash
.scripts/incVersion.sh patch            # edit the files only
.scripts/incVersion.sh patch --commit   # ... and commit
.scripts/incVersion.sh patch --tag      # ... and tag locally (nothing public yet)
.scripts/incVersion.sh patch --push     # ... and push, which releases
```

Nothing leaves the machine until `--push`. To undo a local `--tag`:

```bash
git tag -d v1.32.1 && git reset --hard HEAD~1
```

## What stops a bad release

Four guards in the script, all of which fail **before** any file is written:

- the current branch is not `main`
- the tag already exists, locally or on `origin`
- the four manifests disagree with each other before the bump (it prints all four
  rather than silently "fixing" the odd one out)
- there are already-staged changes that the version commit would sweep up

And one in the workflow, which does not trust the script: the tag version must match
every `package.json` in the repo, or the run fails before building and names each
offending file. A tag that disagrees with the image it produced is silent and permanent
otherwise.

`package-lock.json` is refreshed because `npm ci` rejects a lockfile that disagrees with
its manifests, and the Docker build runs `npm ci` — a bump without it breaks the image,
not the script.

## Rebuilding a branch (the tablet loop)

To get an image onto the tablet without merging or tagging anything:

```bash
gh workflow run publish-image.yml --ref my-branch
```

That publishes the branch's `package.json` version and **deliberately leaves `:latest`
alone**, so a half-finished branch can never become what a fresh deployment pulls. It is
the only way to publish without a tag.

## Branch protection and the release push

`main` requires the `Build and lint` check, and `incVersion.sh --push` pushes the release
commit **directly** to `main` rather than through a PR. That push violates the rule and
succeeds only because repo admins are allowed to bypass it. Git says so out loud:

```
remote: Bypassed rule violations for refs/heads/main:
remote: - Required status check "Build and lint" is expected.
```

This is expected, and the release commit only changes version strings that CI has no
opinion about. But it means **the release path depends on `enforce_admins` being false**:

```bash
gh api repos/sseiber/zwave/branches/main/protection \
  --jq '{checks:.required_status_checks.contexts, admins:.enforce_admins.enabled}'
# {"checks":["Build and lint"],"admins":false}
```

If `admins` ever reads `true` — the "Do not allow bypassing the above settings" box —
`--push` will start failing, and the bump has to go through a PR with the tag pushed
afterwards.

## Credentials

None, anywhere. The workflow authenticates with the run's `GITHUB_TOKEN`, and the package
is public so every pull is anonymous — there is no `docker login` on the Pi and no
personal access token to rotate.

Building locally (`npm run dockerbuild`) is the fallback and *does* need a
`write:packages` token in the local Docker keychain. Prefer the workflow.

## Why a tag and not a version bump on `main`

Publishing used to be inferred: a push to `main` published if `package.json`'s version
had no image in the registry yet. That reads release intent out of the registry instead
of from the author, and it cost two bugs in two days — a merge that skipped every job
while reporting success, and `:latest` stranded on 1.4.0 through six releases. A tag
states the intent, so there is nothing left to infer, and "no tag, no run" replaces the
guard that made merging a documentation fix a question about publish behaviour.
