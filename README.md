# Spotify Like

An Omarchy bar widget: a heart next to the media widget that shows whether
the Spotify track playing now is in your Liked Songs.

- Outline heart: not liked. Left-click adds the track to Liked Songs.
- Filled heart in the theme's accent colour: liked. Right-click removes it
  (so a stray left-click never unlikes a song).
- Likes you make in the Spotify app show up in the bar within a few seconds.
- The heart is hidden whenever a media widget would hide Spotify: Spotify
  closed or stopped (also right after it opens, until you press play). It's
  also hidden for podcasts and ads, which can't be liked.

It works on **Spotify Free**. Spotify's Web API needs Premium and a developer
app for this, so instead a small [Spicetify](https://spicetify.app) extension
inside the desktop app uses the app's own library functions and reports to
the bar over a local connection.

![The heart next to the media widget](preview.png)

## Requirements

- Omarchy (Quattro)
- Spotify desktop app from the Omarchy package (`/opt/spotify`)
- [`spicetify-cli`](https://aur.archlinux.org/packages/spicetify-cli) from the AUR
- `python` (`/usr/bin/python3`), `acl` (`setfacl`) and `util-linux` (`unshare`).
  The last two are always installed; `setup/install` tells you if anything is missing.
- Unprivileged user namespaces (on by default in Arch kernels), used to run
  Spicetify offline

## Install

```bash
omarchy pkg aur add spicetify-cli
omarchy plugin add https://github.com/freezombie/omarchy-spotify-like --enable
~/.config/omarchy/plugins/freezombie.spotify-like/setup/install
```

`setup/install` explains each change and asks before making it:

1. Gives your user write access to `/opt/spotify` with ACLs (needs sudo).
   Spicetify has to patch files there.
2. Offers safer Spicetify settings (see [Security](#security)). Default yes
   on a fresh Spicetify; if you already use Spicetify themes or extensions,
   the default is no and nothing else in your setup changes.
3. Adds the `spotify-like-bridge.js` extension to Spicetify's list, next to
   any extensions you already have.
4. Patches Spotify, offline. If Spotify is open, it's closed for that and
   started again afterwards (it crashes if its files change while it runs).
5. Offers a post-update hook (`~/.config/omarchy/hooks/post-update.d/spotify-like-repatch`)
   that re-patches Spotify after `omarchy update` installs a new Spotify
   (closing and reopening Spotify if it's running).

It's safe to run again. `--yes` accepts the default answers.

## Usage

Click the heart. The same actions are available over IPC, for keybindings:

```bash
omarchy-shell freezombie.spotify-like status   # {"connected":true,"uri":"spotify:track:…","liked":false,…}
omarchy-shell freezombie.spotify-like like
omarchy-shell freezombie.spotify-like unlike
omarchy-shell freezombie.spotify-like toggle
```

## Updating

```bash
omarchy plugin update freezombie.spotify-like
~/.config/omarchy/plugins/freezombie.spotify-like/setup/install
omarchy restart shell
```

Spicetify copies the extension into Spotify when it patches, so run
`setup/install` again after an update to pick up a changed extension. The
shell keeps the plugin's service loaded, so restart it to load a changed
`Service.qml`.

## Removal

```bash
~/.config/omarchy/plugins/freezombie.spotify-like/setup/uninstall
omarchy plugin remove freezombie.spotify-like
```

`setup/uninstall` removes the extension from Spicetify and puts back the
settings install changed. It removes the hook and, once Spotify is back to
stock, your write access to `/opt/spotify`. If install set Spicetify up for
this plugin alone, it offers `spicetify restore`. If you use Spicetify for
other things, it re-applies your setup without this extension.

## Troubleshooting

- **No heart while a song plays.** Run `omarchy-shell freezombie.spotify-like status`.
  - `"spotifyActive":false` means Spotify hasn't started playback (or is
    stopped); press play.
  - `"connected":false` means the extension isn't talking to the bar. Restart
    Spotify, then look for `spotify-like` lines in the shell log
    (`qs log -p /usr/share/omarchy/shell | grep spotify-like`).
  - A `rejected origin` line there means your Spotify identifies itself
    differently; please open an issue with that line.
- **The heart disappeared after `omarchy update`.** A new Spotify replaced
  the patched files. The post-update hook normally re-patches it; if you
  skipped the hook or it failed, run `setup/install` again.
- **`setup/install` says user namespaces are disabled.** Spicetify can't run
  offline on your system; see [Security](#security) for why that matters.

## How it works

```
Spotify app ── Spicetify extension ──ws://127.0.0.1:47851──> bin/spotify-like-bridge ──stdio──> Service.qml ──> BarWidget.qml
```

- `spicetify/spotify-like-bridge.js` runs inside Spotify. On every track
  change, and every 5 seconds, it reports `{uri, liked}` from
  `Spicetify.Platform.LibraryAPI`. It applies a like or unlike only for the
  track playing right now.
- `bin/spotify-like-bridge` is a small WebSocket server (Python standard
  library only) that passes messages between the extension and the shell.
- `Service.qml` runs the bridge once for the whole shell, keeps the state and
  offers the IPC commands. `BarWidget.qml` is the heart.

## Security

Spotify's own code runs the extension, so it can do what the Spotify app
can. Both ends were written to keep that narrow.

**The bridge**
- Listens on `127.0.0.1` only.
- Accepts a connection only with the Spotify app's `Origin`
  (`https://xpui.app.spotify.com`) and a local `Host`. Web pages in a browser
  always send their real origin, so they can't connect.
- Accepts only small messages of one exact shape (a track URI and true,
  false or null). Anything else closes the connection.
- The newest connection wins, and a connection silent for 20 seconds is
  dropped.

**The setup**
- Write access uses ACLs for your user only, instead of the
  `chmod a+wr` Spicetify's docs suggest.
- Spicetify runs offline, in a user and network namespace (`unshare`).
  Otherwise, every time it patches, it downloads `css-map.json` from its
  GitHub `main` branch and writes it into Spotify's JavaScript, bypassing the
  checksummed copy in the AUR package.

**The optional hardening settings**
- `check_spicetify_update 0`: no update check that shows GitHub text inside
  Spotify.
- `inject_theme_js 0`, `experimental_features 0`, `home_config 0`,
  `sidebar_config 0`: no extra code or UI patches beyond this extension.

**Also recommended**
- Update Spicetify through the AUR, not `spicetify update`. The AUR package
  is checksummed; the self-update isn't.
- Don't run `spicetify watch`: it opens a debugging port.
- Spicetify Marketplace extensions are third-party code with no review.
  Install them with that in mind.

## Tests

```bash
/usr/bin/python3 -I -m unittest discover -s tests   # bridge, with a fake client
node tests/test_extension.mjs                       # extension, with a fake Spicetify
```

## License

[MIT](LICENSE)
