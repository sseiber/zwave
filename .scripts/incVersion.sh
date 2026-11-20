#!/bin/bash

# Bump the version across every workspace, then optionally commit, tag and push.
# Pushing a v* tag is what triggers .github/workflows/publish-image.yml, so this
# script is the release: there is no other way to publish :latest.
#
# The point of doing all of it in one command is that the tag and the manifests
# cannot drift. The workflow refuses a tag that disagrees with package.json, which
# is a good check but a poor experience to discover after pushing.
#
# Usage:
#   .scripts/incVersion.sh <major|minor|patch> [--commit] [--tag] [--push]
#   .scripts/incVersion.sh --version <x.y.z>   [--commit] [--tag] [--push]
#
# Examples:
#   .scripts/incVersion.sh patch                    # bump the files, nothing else
#   .scripts/incVersion.sh patch --commit           # bump and commit
#   .scripts/incVersion.sh minor --tag              # bump, commit, tag locally
#   .scripts/incVersion.sh patch --push             # bump, commit, tag, push -> release
#   .scripts/incVersion.sh --version 2.0.0 --push   # same, at an explicit version
#
# There is one image here, so every workspace moves together and there is no
# per-package release. That is the whole difference from loopbox-monorepo's script,
# which this is adapted from.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Everything that carries a version. The workflow checks this exact set.
MANIFESTS=(
    "package.json"
    "packages/contracts/package.json"
    "packages/service/package.json"
    "packages/web/package.json"
)

usage() {
    cat <<USAGE
Usage: $0 <major|minor|patch> [--commit] [--tag] [--push]
       $0 --version <x.y.z>   [--commit] [--tag] [--push]

Arguments:
  major|minor|patch   Version component to increment
  --version <x.y.z>   Set an explicit version instead of incrementing

Flags:
  --commit  Commit the bump
  --tag     Create the v<version> tag (implies --commit)
  --push    Push the commit and the tag, which publishes the image (implies --tag)

Without --commit the files are left modified for you to inspect.
USAGE
    exit 1
}

[[ $# -lt 1 ]] && usage

BUMP_TYPE=""
EXPLICIT_VERSION=""
COMMIT_CHANGES=false
CREATE_TAG=false
PUSH=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        major|minor|patch) BUMP_TYPE="$1" ;;
        --version)
            shift
            if [[ $# -eq 0 ]] || [[ "$1" == --* ]]; then
                echo "Error: --version requires a value (e.g. --version 2.0.0)" >&2
                usage
            fi
            EXPLICIT_VERSION="$1"
            ;;
        --commit) COMMIT_CHANGES=true ;;
        --tag) CREATE_TAG=true; COMMIT_CHANGES=true ;;
        --push) PUSH=true; CREATE_TAG=true; COMMIT_CHANGES=true ;;
        -h|--help) usage ;;
        *) echo "Unknown argument: $1" >&2; usage ;;
    esac
    shift
done

if [[ -n "$EXPLICIT_VERSION" && -n "$BUMP_TYPE" ]]; then
    echo "Error: cannot use both --version and a bump type" >&2
    usage
fi
if [[ -z "$EXPLICIT_VERSION" && -z "$BUMP_TYPE" ]]; then
    echo "Error: specify major, minor, patch, or --version <x.y.z>" >&2
    usage
fi
if [[ -n "$EXPLICIT_VERSION" && ! "$EXPLICIT_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: version must be semver (e.g. 2.0.0), got: $EXPLICIT_VERSION" >&2
    usage
fi

cd "$REPO_ROOT"

read_version() { node -p "require('./$1').version"; }

# The manifests are expected to be in lockstep. Starting from a set that already
# disagrees would quietly "fix" the odd one out and hide that something went wrong.
CURRENT_VERSION="$(read_version "${MANIFESTS[0]}")"
for manifest in "${MANIFESTS[@]}"; do
    found="$(read_version "$manifest")"
    if [[ "$found" != "$CURRENT_VERSION" ]]; then
        echo "Error: versions are out of step before the bump:" >&2
        for m in "${MANIFESTS[@]}"; do echo "  $m: $(read_version "$m")" >&2; done
        echo "Set them all with --version <x.y.z> once you know which is right." >&2
        exit 1
    fi
done

if [[ -n "$EXPLICIT_VERSION" ]]; then
    NEW_VERSION="$EXPLICIT_VERSION"
    echo "Setting version: ${CURRENT_VERSION} -> ${NEW_VERSION} (explicit)"
else
    IFS='.' read -r major minor patch <<< "$CURRENT_VERSION"
    case "$BUMP_TYPE" in
        major) major=$((major + 1)); minor=0; patch=0 ;;
        minor) minor=$((minor + 1)); patch=0 ;;
        patch) patch=$((patch + 1)) ;;
    esac
    NEW_VERSION="${major}.${minor}.${patch}"
    echo "Bumping version: ${CURRENT_VERSION} -> ${NEW_VERSION} (${BUMP_TYPE})"
fi

TAG="v${NEW_VERSION}"

# Fail before touching anything if the release cannot land. A tag that already
# exists means this version was released, and the registry will not take it twice.
if [[ "$CREATE_TAG" == true ]]; then
    if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
        echo "Error: tag ${TAG} already exists locally" >&2
        exit 1
    fi
    if git ls-remote --exit-code --tags origin "refs/tags/${TAG}" >/dev/null 2>&1; then
        echo "Error: tag ${TAG} already exists on origin" >&2
        exit 1
    fi
    branch="$(git rev-parse --abbrev-ref HEAD)"
    if [[ "$branch" != "main" ]]; then
        echo "Error: releases are tagged on main, not ${branch}" >&2
        exit 1
    fi
fi

# Anything already staged would be swept into the version commit
if [[ "$COMMIT_CHANGES" == true ]] && ! git diff --cached --quiet; then
    echo "Error: there are staged changes; commit or reset them first" >&2
    exit 1
fi

echo ""

for manifest in "${MANIFESTS[@]}"; do
    node -e "
        const fs = require('fs');
        const path = '${manifest}';
        const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
        pkg.version = '${NEW_VERSION}';
        fs.writeFileSync(path, JSON.stringify(pkg, null, 4) + '\n');
    "
    echo "  Updated ${manifest} -> ${NEW_VERSION}"
done

# npm ci refuses a lockfile that disagrees with the manifests, and the Docker build
# runs npm ci -- so skipping this would break the image rather than the script.
echo "  Refreshing package-lock.json"
npm install --package-lock-only --silent

echo ""

if [[ "$COMMIT_CHANGES" == true ]]; then
    git add "${MANIFESTS[@]}" package-lock.json
    git commit -q -m "Release ${NEW_VERSION}"
    echo "  Committed: Release ${NEW_VERSION}"
fi

if [[ "$CREATE_TAG" == true ]]; then
    git tag -a "$TAG" -m "Release ${NEW_VERSION}"
    echo "  Tagged: ${TAG}"
fi

echo ""

if [[ "$PUSH" == true ]]; then
    echo "Pushing to origin..."
    git push origin HEAD "$TAG"
    echo ""
    echo "Done. Pushing ${TAG} starts the publish workflow:"
    echo "  gh run watch \$(gh run list --workflow=publish-image.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
elif [[ "$CREATE_TAG" == true ]]; then
    echo "Tag created locally. Push it to publish:"
    echo "  git push origin HEAD ${TAG}"
elif [[ "$COMMIT_CHANGES" == true ]]; then
    echo "Committed. Re-run with --tag to tag it, or --push to release."
else
    echo "Files bumped. Re-run with --commit, --tag or --push when you are happy."
fi
