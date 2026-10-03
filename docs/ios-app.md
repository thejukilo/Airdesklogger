# iOS app (Capacitor)

The iOS app is the existing web app wrapped with [Capacitor](https://capacitorjs.com/).
The app loads its UI from the bundled web build and talks to the live API at
`https://log.airdeck.ch/api`. No separate mobile frontend to maintain: the app
and the website are the same React code.

Everything cross-platform is already in the repo:

- `web/capacitor.config.ts` — app id `ch.airdeck.logger`, name, `webDir: dist`,
  native HTTP enabled (so API calls are not blocked by WebView CORS).
- `web/src/api.ts` — in the native app, API calls target `https://log.airdeck.ch`
  (override with `VITE_API_ORIGIN` for a staging build). On the web they stay
  relative, unchanged.
- `web/src/App.tsx` — the native app never shows the marketing landing page; an
  unauthenticated launch goes straight to sign-in.
- npm scripts in `web/package.json`: `cap:add:ios`, `cap:sync`, `cap:open`.

The `web/ios/` Xcode project is **not** in the repo yet because it can only be
generated on macOS. The steps below create it on your Mac and commit it so
Xcode Cloud can build.

## One-time setup on your Mac

Prerequisites: macOS, Xcode, CocoaPods (`brew install cocoapods`), Node 20, and
your Apple Developer account signed into Xcode.

```sh
# from the repo root
npm ci
cd web
npm run build          # produces web/dist
npx cap add ios        # creates web/ios (one time)
npx cap sync ios        # copies the web build + installs pods
npx cap open ios        # opens the project in Xcode
```

In Xcode, select the **App** target → **Signing & Capabilities**:
- set **Team** to your Apple Developer team,
- confirm the **Bundle Identifier** is `ch.airdeck.logger` (or change it; keep it
  in sync with `appId` in `capacitor.config.ts`),
- set the **Display Name** you want on the home screen.

Run it on the simulator or a device. Because the app calls the live API, you can
sign in with a real account straight away.

### App icon and splash screen

The source art is in `web/assets/` (the same diamond logo as the website):
`icon-only.svg`, `splash.svg`, `splash-dark.svg`. Generate all the sized iOS
icon and splash assets from them (run from `web/`, after `cap add ios`):

```sh
npx @capacitor/assets generate --ios
npx cap sync ios
```

That writes the icon set and splash images into the iOS project; commit them
with the rest of `web/ios/`. The splash background colour is also set in
`capacitor.config.ts` (`SplashScreen.backgroundColor`) and the app hides the
splash from JS once the UI has painted (see `main.tsx`). If `@capacitor/assets`
rejects the SVGs on your machine, open each in Preview and export a PNG at the
same name/size (`icon-only.png` 1024x1024, `splash*.png` 2732x2732).

### Commit the iOS project

Commit the generated `web/ios/` folder: Xcode Cloud builds from the repo and
needs it. Capacitor's generated `.gitignore` already excludes build output and
`Pods/`.

## Xcode Cloud

1. After `npx cap add ios`, copy the provided CI script into place:
   ```sh
   mkdir -p web/ios/App/ci_scripts
   cp docs/ios/ci_post_clone.sh web/ios/App/ci_scripts/ci_post_clone.sh
   chmod +x web/ios/App/ci_scripts/ci_post_clone.sh
   ```
   It installs Node, builds the web app, and runs `cap sync ios` before each
   build, so the app always ships the latest web UI.
2. In Xcode: **Product → Xcode Cloud → Create Workflow**. Pick the **App**
   scheme, set the start condition (for example, push to
   `claude/easa-flight-log-app-TwTiM`, or a dedicated release branch), and add a
   **TestFlight** distribution action.
3. Xcode Cloud runs `ci_post_clone.sh`, then `pod install`, then builds and
   uploads to TestFlight.

## Keeping app-only commits from redeploying the website

Both Vercel and Xcode Cloud watch the repo, so by default a change under
`web/ios/**` would trigger a pointless website redeploy. `scripts/vercel-ignore.sh`
prevents that: it skips the Vercel build when a commit touched nothing but
`web/ios/**`, and builds for anything else.

Set it once, on the Vercel project that serves `log.airdeck.ch`:
**Project Settings -> Git -> Ignored Build Step ->**
```
bash scripts/vercel-ignore.sh
```
It inspects the latest commit, so keep native-only work in its own commits. The
complementary control on the app side is to build the iOS app only on a release
tag or branch in the Xcode Cloud workflow, so website deploys and app releases
run on their own schedules.

## How updates reach the app

The app bundles the web UI, so a UI change reaches users only through a **new
build** (Xcode Cloud → TestFlight / App Store). Changes that are purely backend
(the API) take effect immediately, since the app calls the live API. If you want
instant JS updates without an App Store release later, Capacitor supports live
updates (Appflow / capacitor-updater); not set up here.

## To verify on a real device

- **Sign in, log a flight, list, sign-off flow** over the live API.
- **PDF export.** Native HTTP handles JSON cleanly; the PDF download is a binary
  blob and should be tested on device. If it misbehaves, the fix is to special
  case that one request (fetch it without the native-HTTP patch, or add a CORS
  allowance for the app origin on `/api/export/logbook`).

## Face ID / Touch ID unlock

Biometric unlock is implemented, but iOS requires a usage-description string or
Face ID calls crash. Add it once to the iOS project (it is not auto-generated):

In Xcode, open `App/App/Info.plist` and add a key:
- Key: `Privacy - Face ID Usage Description` (`NSFaceIDUsageDescription`)
- Value: `Unlock your logbook with Face ID.`

Or edit `web/ios/App/App/Info.plist` directly and add:
```xml
<key>NSFaceIDUsageDescription</key>
<string>Unlock your logbook with Face ID.</string>
```
Commit it with the rest of `web/ios/`.

How it works: it is an unlock over an already signed-in session, not a login
replacement. The holder signs in with a password once, enables the toggle under
**Account** (it is hidden on the web and on devices without biometrics), and the
next app launch shows the lock screen. On the simulator, enrol a face first via
**Features -> Face ID -> Enrolled**.

## Recommended native touches (follow-ups)

A wrapped web app is accepted by the App Store when it is a real tool (this is),
but adding native value makes review smoother and the app nicer:

- **Face ID / Touch ID unlock** on launch (biometric gate over the stored
  session) — `@capacitor/preferences` + a biometric plugin.
- **Push notifications** (sign-off completed, trial ending) —
  `@capacitor/push-notifications` + APNs.
- **Status bar / safe-area polish** — `@capacitor/status-bar`.

Say the word and I will wire these in.
