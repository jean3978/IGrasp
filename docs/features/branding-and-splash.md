# Branding and splash

## The logo

The IGrasp mark is a markdown page **held** by a single amber stroke. The stroke reads both as
fingers wrapping around the page and as the letter **G**; its bar is the thumb resting on the
page's heading line. Grasping the documentation, literally.

| File | Use |
|---|---|
| `assets/branding/igrasp.svg` | Color logo (indigo → violet badge). Source of the app icons. |
| `assets/branding/igrasp-mono.svg` | Single-color variant (`currentColor`), for 16–24 px UI use. |
| `src/features/splash/AppLogo.tsx` | The same geometry as a React component (`variant="color" \| "mono"`). |
| `src/features/splash/logoPaths.ts` | Shared path data; keep it in sync with the SVG files. |

Rules: `viewBox="0 0 512 512"`, vector only (no raster, no text, no filters), strokes of at least
12 units so the 16 px icon stays legible. The grip is **one continuous path** so the drawing
animation runs from the top of the G to the tip of the thumb.

## App icons

Generated from the color SVG and committed:

```sh
npm run tauri icon -- assets/branding/igrasp.svg
```

Delete the generated `android/` and `ios/` folders afterwards (desktop only).

## Startup and splash

1. The main window is created **hidden** (`visible: false`) with a dark background color.
2. The frontend loads the settings, applies the theme to `<html data-theme>`, and then shows the
   window, so it never flashes white. If the frontend fails to start, Rust shows the window after
   3 seconds anyway.
3. A full-window overlay (`SplashOverlay`) plays the logo animation in pure CSS: the badge settles,
   the page fades in, and the grip draws itself around the page. It stays at least 1.2 s and until
   the app is ready, then fades out in 300 ms.
4. With `prefers-reduced-motion`, the logo is shown static for 400 ms instead.

The splash is part of the main window (not a separate window) because the app is ready in well
under a second; a second window would only flash. The logo is inline SVG, so it is sharp at any
display scale.
