# Firebase setup (project `tvgames-f984d`)

My PC uses one Firestore database for:
- **`apps`**: the **App Store** catalog. The owner publishes apps and games from a computer with the
  **App Store Manager**: **`https://imad-os.github.io/g/installer/`** (sign in with Google or e-mail,
  admins only). People install what they want on their TV with the **App Store** app of My PC.
- **`appstats`**: how many times each app was installed and opened ("Popular" in the store).
- **`tvs`**: one backup per TV (profiles, settings, saves, installed apps, records), so a
  reinstalled My PC or a reset TV gets everything back. The App Store Manager lists them as statistics.
- **`records`**: the world records (best 10 of each game on every My PC).
- **`rooms`** (with `rooms/<id>/reqs`): lobbies for multiplayer apps (`MyPC.rooms` in the SDK). Written only by the My PC
  shell for the running app; short-lived documents (see **Rooms** below).

TVs never sign in. They read `apps`, `appstats`, `records` and their own `tvs` document, and the rules
let them write only small, checked things (+1 on a counter, their own backup, a top-10 list).

Quick start (once):
1. Firestore: create the database and publish `firebase/firestore.rules` (step 1). **Publish it
   again after every update of the rules file** (this version adds `appstats`, `tvs` and `records`).
2. Authentication: enable **Google** and **Email/Password**, add `imad-os.github.io` to the
   authorized domains (step 2).
3. Open the App Store Manager, sign in, copy the user ID it shows, and add it to `admins` (step 2.5).
4. Reload it. **Apps from imad-os** lists every repository of `imad-os` named `g_…` that has
   GitHub Pages and a `mypc-app.json`: tick them and press **Add selected to the store** (the ones
   already in the store are marked; changed ones show **Update**). For apps elsewhere, paste the
   address under **Add from another address** (try `https://imad-os.github.io/g/sdk/example/`).
   They are in the App Store of every My PC right away.

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

## 3. App Store catalog (`apps` collection)
The App Store Manager writes these from each app's `mypc-app.json` (see `sdk/GUIDE.md`). The rules
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
| `enabled` | boolean | `false` hides it in the App Store (installed copies stop opening) |
| `order` | integer 0–999 | position in the manager's list |
| `installedAt`, `installedBy` | timestamp, string (optional) | when and by whom it was added to the store ("New" in the store) |
| `config` | map (optional) | `{ "speed": 2, "levels": [1, 2] }`: edited per app in the App Store Manager (**Config**), read by the app as `MyPC.app_config` |

TVs read the list with a plain request (no SDK, no sign-in):
`GET https://firestore.googleapis.com/v1/projects/tvgames-f984d/databases/(default)/documents/apps?key=<apiKey>`

## 3b. What the TVs write
| collection | document | written by | rules |
|---|---|---|---|
| `appstats` | app id: `{ installs, opens }` | a TV, when an app is installed or opened | only +1 on one counter |
| `tvs` | `tv-<hash of the TV's own id>` | the TV, a little after something changes | only that shape, backup ≤ 900 KB; anyone can `get`/`delete` one document by id, only admins can list them |
| `records` | game id: `{ list: [{ n, s, d, tv }], updatedAt }` | a TV, after a new record | at most 10 small entries |

The TV id is a hash of the Samsung DUID (`webapis.productinfo.getDuid()`, needs the `productinfo`
privilege in `config.xml`, so package 1.3.0 or newer); the DUID itself never leaves the TV. It stays
the same after a factory reset. Without it (a PC browser, an older package) the TV uses a random id,
which is lost when the app's data is deleted. People can turn the backup and the world records off,
or delete their backup, in **Settings > Privacy & security**.

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
  **Token Service API** (the App Store Manager's sign-in uses all three).
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
- An unauthenticated `list` on `/tvs` → denied; `get` on `/tvs/tv-…` → allowed.
- An unauthenticated `update` on `/appstats/x` that adds 2 → denied; adding 1 → allowed.

## 4. Rooms (`MyPC.rooms`): index and TTL (once)
Apps and games can offer local multiplayer without their own backend (`sdk/GUIDE.md`, "Rooms"). The shell writes
`rooms/{room}` (`app, name, max, n, at, exp`) and `rooms/{room}/reqs/{req}` (`name, offer, exp, answer?, no?`); the rules
in `firestore.rules` check size, shape and that `exp` is at most 90 s ahead. There is no sign-in, so **keep nothing private
there**. After publishing the new rules (step 1), do these two things in the console:

1. **Composite index** (the room list asks for one app's live rooms, newest first). Firestore → **Indexes → Composite → Add index**:
   collection ID `rooms`, fields `app` Ascending, `exp` Descending, query scope **Collection**. (Or
   `firebase deploy --only firestore:indexes` with `firebase/firestore.indexes.json`.) Until it is built (a minute) the TV
   falls back to a simpler query, so nothing breaks.
2. **TTL policies** so abandoned rooms and requests are deleted for free: Firestore → **TTL → Create policy**:
   collection group `rooms`, timestamp field `exp`; then collection group `reqs`, timestamp field `exp`.
   (CLI: `gcloud firestore fields ttls update exp --collection-group=rooms --enable-ttl` and the same for `reqs`.)
   TTL deletes within about a day of `exp`; the apps already ignore expired rooms, and the shell deletes its own
   room and requests when the app closes.

Cost: a room costs a few writes (heartbeat every 15 s while a host waits), requests are polled every 1.5-2 s. Both stop when
the room closes or the app is closed. Rate limits (1 open room, 5 asks per minute per TV) are in `js/core/rooms.js`.
