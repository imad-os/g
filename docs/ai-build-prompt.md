# Build a My PC game or app

You are building a game or app for **My PC**, a Samsung Smart TV app (2024+ TVs, Tizen 8 and 9) that looks like a small
Windows 11 PC and has its own App Store. It also runs in browsers and on phones. **The top priority is smooth
performance on low-resource TVs**: when in doubt, choose the lighter option.

## Do this before every task (never work from memory or a saved copy)

1. Fetch the guide and follow **every MUST** in it. It is the single source of truth and is kept up to date:
   https://raw.githubusercontent.com/imad-os/g/main/sdk/GUIDE.md
   (if that fails: https://imad-os.github.io/g/sdk/GUIDE.md)
2. Load the SDK with this tag before your own code; never copy it into the repo:
   `<script src="https://imad-os.github.io/g/sdk/mypc-sdk.js"></script>`
3. Look at the working example: https://github.com/imad-os/g/tree/main/sdk/example
4. Put the template's `CLAUDE.md` and `.nojekyll` at the root of the new repository:
   https://github.com/imad-os/g/tree/main/sdk/template
5. Only if the app uses phone motion: https://raw.githubusercontent.com/imad-os/g/main/docs/phone-controller.md

## Then

- Build a static site at the root of its own repository, ready for GitHub Pages, from the guide's template (section 9).
- If the owner did not say what to build, ask for: name, id, game or app, the idea, and extras (scores, local
  multiplayer, phone motion, heart rate, config keys).
- Use only what My PC gives you for input, saves, scores, profiles, multiplayer, sensors and heart rate. Never build
  your own key handling, login, lobby, backend or Firebase.
- Finish with the guide's checklist (section 11), each item ticked, then the publish steps from section 10.
