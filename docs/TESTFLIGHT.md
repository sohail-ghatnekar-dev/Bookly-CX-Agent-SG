# Shipping Bookly to TestFlight

Internal testing only: up to 100 people on your App Store Connect team, with no beta app review.

## 1. Point the app at the hosted project

In `ios/Bookly/Config.xcconfig`, set the hosted project URL (`https:/$()/<your-project-ref>.supabase.co`) and the hosted anon key. Never put the service-role or Anthropic key here. Run `make doctor` to confirm.

Make sure the hosted project has anonymous sign-ins enabled and `ALLOW_REDTEAM=false` (see "Setting it up" in the README).

## 2. Set the team and bundle ID

1. Open `ios/Bookly/Bookly.xcodeproj` in Xcode.
2. Select the **Bookly** target, then **Signing & Capabilities**.
3. Choose your **Team**, and keep **Automatically manage signing** on.
4. Replace the bundle identifier `com.example.bookly` with one you own, for example `com.yourname.bookly`.
5. In App Store Connect → **Apps** → **+** → **New App**, create the app with that bundle ID, platform iOS, name "Bookly" (or any available name), and SKU `bookly`.

## 3. Bump the build number

Each upload needs a new build number. On the **General** tab, raise **Build** (`CURRENT_PROJECT_VERSION`) by one, for example 1 → 2. Keep **Version** (`MARKETING_VERSION`) at 1.0 unless you mean to release a new version.

`ITSAppUsesNonExemptEncryption` is already `NO` in `Info.plist`, so App Store Connect won't ask about export compliance.

## 4. Archive

1. Set the run destination to **Any iOS Device (arm64)**.
2. Choose **Product → Archive**.
3. When it finishes, the Organizer opens with the new archive selected.

## 5. Upload with the Organizer

1. Click **Distribute App**, choose **TestFlight Internal Only**, then **Distribute**.
2. Xcode signs and uploads the build. Processing in App Store Connect usually takes 5–15 minutes, and you'll get an email when it's done.

## 6. Create an internal testing group

1. In App Store Connect, open the app → **TestFlight**.
2. Under **Internal Testing**, click **+**, name the group (for example "Bookly team"), and add testers from your team.
3. Add the processed build to the group. Internal builds don't go through beta app review.

## 7. Install

Testers get an email invite. They install **TestFlight** from the App Store, accept the invite, and tap **Install** on Bookly. Later builds added to the group show up in TestFlight automatically.
