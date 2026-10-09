# Fetish Network - Full Video Unlock

A userscript that plays **full-length scenes** instead of trailers on `hentaied.com` and its sibling sites, without touching the player.

```
Trailer (what the page gives guests)   https://hls.fetish.lol/trailers/hentaied/Awoken/hls/master.m3u8
Full scene (what this script requests) https://hls.fetish.lol/hentaied/Awoken/hls/master.m3u8
                                                  ^^^^^^^^^ only difference
```

Verified on `Awoken`: trailer `30s` → full scene `2037.75s` (33:57), with a 4K rendition available.

## How it works

The site is WordPress plus an aMember Pro membership backend. The paywall is front-end only. The theme bundle contains the entire player logic:

```javascript
var src = preview.getAttribute('data-preview-src');   // reads the trailer URL
hls.loadSource(src);                                  // hls.js fetches it
video.addEventListener('ended', () => modal.classList.add('opened'));  // wall on finish
```

The full-length playlist lives on the same host at the same path, one `/trailers` segment away. The player cannot tell the two URLs apart at the request layer, so rewriting `XMLHttpRequest.prototype.open` and `fetch` is enough: hls.js happily pulls the full scene and no player code changes.

The member wall is just a `div` shown on the `ended` event. A full scene runs 20-40 minutes, so `ended` never fires; the script also removes the node outright as a belt-and-braces measure.

Two server-side facts make a proxy unnecessary:

- The HLS host returns `Access-Control-Allow-Origin: *`, so cross-origin reads are permitted.
- The page carries `<meta name="referrer" content="unsafe-url">`, so browser-issued requests automatically send the `Referer` the server requires. Requests without it get `403`; with it, `200`.

## Features

- **Request-layer rewrite** of XHR, `fetch`, `Request`, `URL` and `HTMLMediaElement.prototype.src`, so both hls.js and native HLS (Safari) paths are covered.
- **Quality control** - pick `auto`, `4k`, `1080p` or `720p`. A non-auto choice rewrites the master playlist request straight to that rendition, skipping hls.js bitrate probing.
- **Resume playback** - per-video position stored in `localStorage`, restored on load.
- **Keyboard shortcuts** - `←`/`→` seek 10s, `↑`/`↓` volume, `Space` pause, `F` fullscreen, `P` picture-in-picture.
- **Panel** - draggable, collapsible overlay showing unlocked status, real duration, quality selector and a one-click copy of the equivalent `ffmpeg` download command.
- **Removes** the member modal, `PREVIEW` badge, buy notice and preview banner.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey).
2. Open the raw `.user.js` and confirm the install prompt.

## Sites covered

`hentaied.com`, `vampired.com`, `vored.com`, `voodooed.com`, `monsterporn.com`, `parasited.com`, `plantsvscunts.com`, `cumflation.com`, `futanari.xxx`, `freeze.xxx` - all served by the same `hls.fetish.lol` backend.

To cover another site on the same backend, add a `@match` line. The rewrite is keyed on `/trailers/<brand>/`, not on the domain.

## Companion CLI

For batch download or when you want files rather than a browser, see `hentaied_unlock.py` in the parent directory. It enumerates every video on the site, resolves full-length playlists, and offers a local proxy so any player (IINA, mpv, VLC) can open the full scene directly.

## Known limits

Thirteen older titles (2020-2022 remasters and `vol` series, e.g. `Oviposition 2/3`, `Jiology Lab`, `Ahegao Masturbation Session`) store the full scene under a directory name unrelated to the trailer title. The script cannot derive it; the same limitation applies to the CLI. Every other title on the site resolves.

## Legal

Personal use. The script does not bypass authentication or DRM; it requests a publicly served, unauthenticated HLS playlist that the page simply does not hand to guests. Support the studios if you can afford to.

## License

MIT
