#!/bin/sh
#
# Xcode Cloud post-clone step for the Capacitor iOS app.
#
# Copy this file to  web/ios/App/ci_scripts/ci_post_clone.sh  after you have run
# `npx cap add ios` on your Mac (that is where the iOS project lives). Xcode
# Cloud runs it on a clean macOS image before building, so it installs Node,
# builds the web app, and syncs the result into the iOS project. Xcode Cloud
# runs `pod install` automatically once it sees the Podfile.
#
set -e

echo "==> Installing Node"
brew install node@20
export PATH="$(brew --prefix node@20)/bin:$PATH"
node --version
npm --version

echo "==> Installing dependencies (workspace root)"
cd "$CI_PRIMARY_REPOSITORY_PATH"
npm ci

echo "==> Building the web app"
npm run build:web

echo "==> Syncing Capacitor iOS"
cd "$CI_PRIMARY_REPOSITORY_PATH/web"
npx cap sync ios

echo "==> Done"
