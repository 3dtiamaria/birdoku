# Birdoku — your private bird puzzle 🐦

A tiny offline-first game for Android (and desktop), inspired by the colored-region bird/queen logic puzzle. No ads, no tracking, no accounts, no subscription, and no libraries to install.

## Rules

Place **one bird in each row, column and colored region**. Birds can't touch, even diagonally. **Tap a square once to place an X, tap it again to place a bird, and tap a third time to clear it.** No tool selector needed. **Drag your finger across a row, column, or group of cells to mark multiple X's in one swipe**; one swipe is one Undo move. The first tap's X is temporary so you can place a bird with the second tap even on its correct square. A mistaken bird placement gives a gentle hint instead of a penalty. There's Undo, Restart and an optional Hint button.

## Difficulty

The grid size (6×6, 8×8, 10×10) is independent of difficulty. **Easy** begins with about 19% of cells eliminated, **Medium** with about 6%, and **Hard** with no starter crosses. Each board is checked to have exactly one valid solution. Connected colored regions are generated in a background worker, with pre-generated boards for instant first play.

## Install on your phone

1. Unzip all the files and upload **the contents of this folder** to a free GitHub repository.
2. On GitHub, open **Settings → Pages**, choose **Deploy from a branch → main → /(root)**, then save.
3. Open the GitHub Pages HTTPS address for your game in **Chrome on your Fairphone**.
4. From Chrome's menu choose **Install app** or **Add to Home screen**.
5. Open Birdoku from your home screen. After the first online visit finishes caching, the game runs **offline**.

**Note:** Playing is free and offline after the initial installation; publishing it once requires an internet connection. Don't clear the app's site data if you want to keep your saved game. No Google Play publishing or developer account is needed.

## Test on a computer

- A quick test: open `index.html` in your desktop browser. The bundled starter puzzles work immediately (some browsers block the background worker when opened from a local file).
- To test install/offline behavior, in a terminal inside this folder run `python -m http.server 8000` and visit `http://localhost:8000`. Service workers work on localhost, which is treated as a secure development origin.

All source code is included. Nothing is sent to an external server; progress lives only in the browser's local storage.
