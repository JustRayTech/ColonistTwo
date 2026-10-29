# Colonists — readable source package

A browser-based hex-tile resource and building game inspired by classic island-settlement board games.

## Files

- `Colonists.html` — convenience redirect to the lobby.
- `lobby.html` — create a room, join a room by code, or start a local demo.
- `game.html` — the actual game board and player controls.
- `styles.css` — shared design tokens and clearly grouped layout/component styles.
- `app.js` — game rules, board generation, building actions, notifications, and page startup. Functions and variables use descriptive names and section comments.

## Run locally

Keep all files in the same folder. Open `Colonists.html` or `lobby.html` in a modern browser. For best results, serve the folder over HTTP using a small local web server, especially for ES modules and Firebase.

Choose **Play local demo** to test the opening settlement/road sequence without Firebase. The lobby navigates to `game.html` once a game is created or joined.

## Enable online multiplayer

1. Create a Firebase project and enable Realtime Database.
2. In `app.js`, replace the placeholder values in `FIREBASE_CONFIG` with your Firebase web app configuration.
3. Configure database security rules for your test or deployment. Do not use unrestricted public writes for a public game.
4. Serve the files over HTTP/HTTPS, create a room, and share its code.

## Where to edit

- Page structure and labels: `lobby.html` and `game.html`
- Colors, spacing, responsive layout, game board, and notifications: `styles.css`
- Game rules and behavior: `app.js`

The board data is kept JSON-serializable: cell-to-vertex adjacency is stored as IDs rather than circular object references. This is important for Firebase synchronization.

This is a fan-made prototype, not an official product or a complete implementation of any commercial board game.
