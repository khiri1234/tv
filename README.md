# H TV for VIDAA (Hisense)

A player only. No channels or content are included. Add your own M3U link or Xtream Codes login.

Files: index.html, app.js, style.css, hls.min.js (hls.js 1.5.17, Apache-2.0). No build step.

## Quick test install (per VIDAA's WebApp guide)
On the TV browser open `hisense://debug`, enter an app name and the App URL (must start with http or https; HTTPS recommended).

## Try it on the TV right now
1. Put the folder on any HTTPS web host (GitHub Pages, Netlify, your own site, e.g. hatef.cc/htv-tv/).
2. On the Hisense TV open the built-in browser and go to that address.

## Remote control
Arrows move, OK selects, Back goes back. Live TV: OK = preview, OK again = fullscreen, Up/Down in fullscreen = change channel, Right on a channel = favorite.

## Known limits
- Written without a TV to test on. Check HLS playback on the real TV.
- Playlists and guide data load from the TV's browser, so the provider's server must allow it (CORS). If loading fails, use the Proxy field in Settings.
- Guide: Xtream "now / next" only. No full grid guide and no XMLTV yet.
- Movies and Series need an Xtream Codes playlist (M3U playlists show live channels only).
- The library reloads each time the app opens (favorites and recents are saved).
- Older VIDAA browsers (Chromium 77 and similar) are the target, so the code avoids newer CSS. Test on a real TV.
- If the app is served over HTTPS, the browser blocks playlists and streams that use plain http:// (mixed content). Use a proxy that serves HTTPS, or test from an http:// address.
