# Firebase setup (project `tvgames-f984d`)

The TVs only **read** the game list. You manage it from the admin page
(`https://imad-os.github.io/g/admin/`) after signing in with Google.

## 1. Firestore database
1. Go to Firebase console → **Build → Firestore Database** → *Create database*. Production mode,
   in the region nearest to your users (e.g. `eur3` or `us-central`).
2. Open the **Rules** tab, paste the content of `firebase/firestore.rules`, and click **Publish**.

## 2. Admin sign-in (Firebase Authentication)
1. **Build → Authentication → Get started → Sign-in method** → enable **Google** and set the
   support e-mail.
2. **Authentication → Settings → Authorized domains** → add `imad-os.github.io` (keep
   `localhost` for testing).
3. Open the admin page once and sign in with your Google account. This creates your user.
4. **Authentication → Users**: copy your **User UID**.
5. **Firestore → Data** → *Start collection* `admins` → document ID = **your UID** → add any field,
   e.g. `name: "owner"` (string). Only UIDs listed here can add, edit, reorder or delete games.
   To add another admin, add their UID the same way. To remove one, delete their document.

## 3. Game documents (`games` collection)
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

## 4. API key restrictions (Google Cloud console → APIs & Services → Credentials)
- Restrict the key to the APIs it needs: **Cloud Firestore API** and **Identity Toolkit API**.
- Do **not** add an HTTP-referrer restriction. The packaged TV app has no web origin, and its
  requests would be refused.
- The key is public by design. Security comes from the rules above, so never relax them to
  `allow write: if true`.

## 5. Check the rules
In the Firestore **Rules** tab → *Rules Playground*:
- An unauthenticated `get` on `/games/x` → allowed.
- An unauthenticated `create` on `/games/x` → denied.
- An authenticated `create` with your UID (after step 2.5) → allowed.

## 6. Admin page
`admin/index.html` (published with the rest of the repo on GitHub Pages, never in the `.wgt`) lists the games and
lets you add (paste a URL: its `game-manifest.json` prefills the form), enable/disable, delete, reorder (drag or
▲ ▼), preview, and "Import bundled games" (writes the first-party games with `bundled: true`). Fields are checked
with the same rules as `firestore.rules` before saving; a rejected write shows the reason. For local tests a
game URL may be `http://localhost:<port>/` on the TV side only; the rules still require https for writes.
