#!/usr/bin/env bash
#
# Vercel "Ignored Build Step".
#
# Vercel runs this before a build and reads the exit code:
#   exit 0  -> SKIP the deployment (no build)
#   exit 1  -> PROCEED with the deployment
#
# We skip the website/API deploy only when the latest commit changed nothing but
# the native iOS app (web/ios/**). Any change anywhere else deploys as normal.
#
# Set it in Vercel: Project Settings -> Git -> Ignored Build Step ->
#   bash scripts/vercel-ignore.sh
# on the project that serves log.airdeck.ch.

set -e

# No previous commit to compare against (first build / shallow clone): build.
if ! git rev-parse HEAD^ >/dev/null 2>&1; then
  echo "No previous commit to diff against. Building."
  exit 1
fi

# `git diff --quiet` exits 0 when there is NO change in the given paths, 1 when
# there is. We look at everything EXCEPT web/ios.
if git diff --quiet HEAD^ HEAD -- . ':(exclude)web/ios'; then
  echo "Only web/ios/** changed in this commit. Skipping website/API deploy."
  exit 0
else
  echo "Changes outside web/ios/**. Deploying."
  exit 1
fi
