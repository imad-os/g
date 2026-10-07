# Firebase setup (project `tvgames-f984d`)

The TVs only **read**: the list of installed apps (collection `apps`) and, later, the game list.
You install apps from a computer with the **installer page**:
**`https://imad-os.github.io/g/installer/`** (sign in with Google or e-mail, admins only).

Quick start (once):
1. Firestore: create the database and publish `firebase/firestore.rules` (step 1).
2. Authentication: enable **Google** and **Email/Password**, add `imad-os.github.io` to the
   authorized domains (step 2).
3. Open the installer, sign in, copy the user ID it shows, and add it to `admins` (step 2.5).
4. Reload the installer: paste an app address (try `https://imad-os.github.io/g/sdk/example/`),
   press **Check**, then **Install**. TVs show it at their next start.

## 1. Firestore database
1. Go to Firebase console → **Build → Firestore Database** → *Create database*. Production mode,
   in the region nearest to your users (e.g. `eur3` or `us-central`).
2. Open the **Rules** tab, paste the content of `firebase/firestore.rules`, and click **Publish**.

## 2. Admin sign-in (Firebase Authentication)
1. **Build → Authentication → Get started → Sign-in method** → enable **Google** (set the
   support e-mail) and **Email/Password**.
2. **Authentication → Settings → Authorized domains** → add `imad-os.github.io` (keep
   `localhost` for testing).
3. Open the installer page once and sign in (Google, or *Create account* with e-mail). This creates
   your user, and the page shows your user ID.
4. **Authentication → Users**: copy your **User UID**.
5. **Firestore → Data** → *Start collection* `admins` → document ID = **your UID** → add any field,
   e.g. `name: "owner"` (string). Only UIDs listed here can add, edit, reorder or delete games.
   To add another admin, add their UID the same way. To remove one, delete their document.

## 3. Installed apps (`apps` collection)
The installer writes these from each app's `mypc-app.json` (see `sdk/GUIDE.md`). The rules
enforce the format:

| field | type | example |
|---|---|---|
| *(document id)* = `id` | `a-z 0-9 -`, 2–32 chars | `star-catcher` |
| `name` | string ≤ 40 | `Star Catcher` |
| `description` | string ≤ 120 (optional) | `Catch the falling stars` |
| `url` | https string | `https://imad-os.github.io/g/sdk/example/` |
| `entry` | https string | `https://imad-os.github.io/g/sdk/example/index.html` |
| `icon` | https string or `""` | `https://imad-os.github.io/g/sdk/example/icon.svg` |
| `type` | `game` or `app` | `game` |
| `version` | string (optional) | `1.0.0` |
| `sdk` | integer (optional) | `1` |
| `scores` | boolean (optional) | `true` |
| `enabled` | boolean | `false` hides it on every TV |
| `order` | integer 0–999 | position on the desktop |
| `installedAt`, `installedBy` | timestamp, string (optional) | set by the installer |

TVs read the list with a plain request (no SDK, no sign-in):
`GET https://firestore.googleapis.com/v1/projects/tvgames-f984d/databases/(default)/documents/apps?key=<apiKey>`

## 4. Game documents (`games` collection, for later)
The admin page writes these for you. This is the format, which the rules enforce:

| field | type | example |
|---|---|---|
| *(document id)* | `a-z 0-9 -`, 2–32 chars | `neon-rush` |
| `title` | map | `{ en: "Neon Rush", fr: "Neon Rush" }` (en required) |
| `description` | map (optional) | `{ en: "Street racing in a neon city" }` |
| `url` | string | `https://someone.github.io/neon-rush/` or `games/jumper/` (bundled) |
| `cover` | string (optional) | `https://someone.github.io/neon-rush/cover.png` |
| `enabled` | boolean | `true` (false hides it on every TV) |
| `order` | integer 0–999 | position in the hub grid |
| `minShell`, `sdk`, `build` | integers (optional) | `1`, `1`, `3` |
| `bundled` | boolean (optional) | `true` for the games shipped inside the `.wgt` |
| `tags` | list (optional, ≤ 5) | `["experimental"]` |
| `updatedAt` | timestamp (optional) | set by the admin page |

TVs read the list with a plain request (no SDK):
`GET https://firestore.googleapis.com/v1/projects/tvgames-f984d/databases/(default)/documents/games?key=<apiKey>`

## 5. API key restrictions (Google Cloud console → APIs & Services → Credentials)
- Restrict the key to the APIs it needs: **Cloud Firestore API**, **Identity Toolkit API** and
  **Token Service API** (the installer's sign-in uses all three).
- Do **not** add an HTTP-referrer restriction. The packaged TV app has no web origin, and its
  requests would be refused.
- The key is public by design. Security comes from the rules above, so never relax them to
  `allow write: if true`.

## 6. Check the rules
In the Firestore **Rules** tab → *Rules Playground*:
- An unauthenticated `get` on `/games/x` → allowed.
- An unauthenticated `create` on `/games/x` → denied.
- An authenticated `create` with your UID (after step 2.5) → allowed.
- An unauthenticated `get` on `/apps/x` → allowed; an unauthenticated `create` → denied.
