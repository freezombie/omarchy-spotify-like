# Spotify Like (Omarchy bar plugin)

A heart next to the media widget. It shows whether the playing Spotify track
is in Liked Songs; left-click adds it, right-click removes it. It works on a
Free account: instead of Spotify's Web API (Premium + developer app since
February 2026), a small Spicetify extension inside the desktop app uses the
app's own library functions.

```
Spotify app ── Spicetify extension ──ws://127.0.0.1:47851──> bin/spotify-like-bridge ──stdio──> Service.qml ──> BarWidget.qml
```

## Pieces

- `spicetify/spotify-like-bridge.js`: reports `{uri, liked}` on track change
  and every 5 s; applies `set` requests only for the track playing right now.
- `bin/spotify-like-bridge`: Python stdlib WebSocket server on 127.0.0.1.
  Accepts only the Spotify app's Origin (`https://xpui.app.spotify.com`) and
  a matching Host, so browser pages can't connect; validates every message
  and drops the client on anything unexpected. Rejected origins are logged to
  the shell log.
- `Service.qml`: runs the bridge once for the shell, keeps the state, and
  offers IPC: `omarchy-shell freezombie.spotify-like status|like|unlike|toggle`.
- `BarWidget.qml`: the heart, hidden while nothing likeable is playing.

## Setup

1. Install `spicetify-cli` from the AUR.
2. `setup/grant-spotify-write-access` (sudo): write access for your user
   only, via ACLs, on `/opt/spotify` and `/opt/spotify/Apps`.
3. `setup/install-spicetify-extension`: links the extension, sets the safe
   config (no update check, no extra UI patches, only this extension), runs
   `spicetify backup apply`.
4. `omarchy hook install post-update setup/post-update-hook`: re-patches after
   an `omarchy update` replaces Spotify.

Never run `spicetify watch`: it opens a remote debugging port.

## Undo

```bash
spicetify restore
sudo setfacl -R -b /opt/spotify
omarchy plugin disable freezombie.spotify-like
rm ~/.config/omarchy/plugins/freezombie.spotify-like
rm ~/.config/omarchy/hooks/post-update.d/post-update-hook
```

## Tests

```bash
/usr/bin/python3 -I -m unittest discover -s tests   # bridge, fake client
node tests/test_extension.mjs                       # extension, fake Spicetify
```
