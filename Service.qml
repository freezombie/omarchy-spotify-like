import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Services.Mpris
import "MediaWidgets.js" as MediaWidgets

// Runs bin/spotify-like-bridge once for the whole shell (the widget may be on
// several bars) and keeps the latest state it reports. Also decides, once for
// all bars, when the heart shows and where it sits (MediaWidgets.js).
Item {
  id: root

  property var shell: null
  property var manifest: null

  readonly property string heartId: "freezombie.spotify-like"

  property bool connected: false
  property string uri: ""
  property var liked: null
  property string lastError: ""

  // Spotify's MPRIS player, as media widgets see it. Spotify reports Stopped
  // right after it opens, until playback starts.
  readonly property var players: Mpris.players ? Mpris.players.values : []
  readonly property var spotifyPlayer: findSpotifyPlayer()
  readonly property bool spotifyHasInfo: spotifyPlayer !== null
    && !!(spotifyPlayer.trackTitle || spotifyPlayer.trackArtist)
  readonly property bool spotifyStopped: spotifyPlayer !== null
    && spotifyPlayer.playbackState === MprisPlaybackState.Stopped
  readonly property bool spotifyPlaying: spotifyPlayer !== null && spotifyPlayer.isPlaying === true
  // Media widgets switch to a player that is playing, so while Spotify isn't,
  // the widget shows that one instead.
  readonly property bool otherPlayerPlaying: findOtherPlaying()

  // A likeable track Spotify also shows to media widgets.
  readonly property bool hasTrack: connected && uri !== "" && liked !== null && spotifyHasInfo

  // The bar layout, as the bar widgets report it, and what follows from it.
  property var layout: ({})
  property string layoutKey: ""
  property var placementState: ({})
  property var pendingMove: null
  readonly property var heartEntry: {
    var heart = MediaWidgets.entryFor(layout, heartId)
    return heart ? heart.entry : null
  }
  readonly property var media: MediaWidgets.detectMedia(layout, heartEntry ? heartEntry.mediaWidget : "")
  readonly property string mediaWidget: media ? media.id : ""
  readonly property string hideWhen: MediaWidgets.hideRule(media, heartEntry)
  readonly property string placement: MediaWidgets.placementOf(heartEntry)

  // Shown and hidden the way the media widget next to it shows Spotify.
  readonly property bool showHeart: hasTrack
    && !(hideWhen === "stopped" && spotifyStopped)
    && !(hideWhen === "paused" && !spotifyPlaying)
    && !(!spotifyPlaying && otherPlayerPlaying)
  readonly property var uriPattern: /^spotify:track:[A-Za-z0-9]{22}$/

  readonly property string bridgePath: {
    var path = String(Qt.resolvedUrl("bin/spotify-like-bridge"))
    return path.indexOf("file://") === 0 ? decodeURIComponent(path.substring(7)) : path
  }

  // The desktop app's exact bus name; spotifyd and other Spotify players use
  // their own (org.mpris.MediaPlayer2.spotifyd.instanceN, …).
  function findSpotifyPlayer() {
    for (var i = 0; i < players.length; i++) {
      var player = players[i]
      if (player && String(player.dbusName || "") === "org.mpris.MediaPlayer2.spotify") return player
    }
    return null
  }

  // playerctld only mirrors another player, as in Omarchy's media widget.
  function isProxyPlayer(player) {
    return String(player.dbusName || "").indexOf("playerctld") !== -1
      || String(player.desktopEntry || "") === "playerctld"
  }

  function findOtherPlaying() {
    for (var i = 0; i < players.length; i++) {
      var player = players[i]
      if (!player || player === spotifyPlayer || isProxyPlayer(player)) continue
      if (player.isPlaying && (player.trackTitle || player.trackArtist)) return true
    }
    return false
  }

  // Called by every bar widget instance; the same layout is handled once.
  function noteLayout(next) {
    var key
    try { key = JSON.stringify(next || {}) } catch (e) { return }
    if (key === layoutKey) return
    layoutKey = key
    layout = JSON.parse(key)
    runPlacement({})
  }

  function runPlacement(options) {
    var result = MediaWidgets.placementStep(placementState, layout, heartId, options)
    placementState = result.state
    if (result.move) startMove(result.move)
    return result
  }

  function startMove(move) {
    if (!move || !MediaWidgets.isValidId(move.target) || MediaWidgets.SIDES.indexOf(move.side) === -1) return
    if (mover.running) {
      pendingMove = move
      return
    }
    mover.command = ["omarchy-bar", "move", heartId, "--" + move.side, move.target]
    mover.running = true
  }

  // place [after|before]: put the heart next to the media widget now.
  function placeNow(side) {
    var wanted = String(side || "")
    if (wanted !== "" && MediaWidgets.SIDES.indexOf(wanted) === -1) return "invalid-side"
    if (!MediaWidgets.entryFor(layout, heartId)) return "not-on-bar"
    if (!media) return "no-media-widget"
    if (wanted === "" && placement === "") return "no-placement"
    return runPlacement({ force: true, side: wanted }).move ? "ok" : "adjacent"
  }

  function setLiked(value) {
    if (!hasTrack || !bridge.running) return false
    bridge.write("set " + uri + " " + (value ? "1" : "0") + "\n")
    return true
  }

  function handleLine(line) {
    var msg
    try { msg = JSON.parse(line) } catch (e) { return }
    if (!msg || typeof msg !== "object") return
    if (msg.type === "state") {
      var okUri = typeof msg.uri === "string" && (msg.uri === "" || uriPattern.test(msg.uri))
      var okLiked = msg.liked === null || typeof msg.liked === "boolean"
      if (!okUri || !okLiked || typeof msg.connected !== "boolean") return
      connected = msg.connected
      uri = msg.uri
      liked = msg.uri === "" ? null : msg.liked
      lastError = ""
    } else if (msg.type === "error" && typeof msg.message === "string") {
      lastError = msg.message.substring(0, 200)
    }
  }

  function statusObject() {
    return {
      connected: connected, uri: uri, liked: liked,
      spotifyHasInfo: spotifyHasInfo, spotifyStopped: spotifyStopped, spotifyPlaying: spotifyPlaying,
      otherPlayerPlaying: otherPlayerPlaying, mediaWidget: mediaWidget, hideWhen: hideWhen,
      placement: placement || "manual", showHeart: showHeart,
      error: lastError, bridgeRunning: bridge.running
    }
  }

  Process {
    id: bridge
    // Called explicitly rather than through the shebang: the shell's PATH may
    // have a version manager's python3 shim first.
    command: ["/usr/bin/python3", "-I", root.bridgePath]
    stdinEnabled: true
    running: true
    stdout: SplitParser { onRead: function (data) { root.handleLine(data) } }
    stderr: SplitParser { onRead: function (data) { console.warn("[spotify-like] " + data) } }
    onExited: function (exitCode) {
      root.connected = false
      root.uri = ""
      root.liked = null
      restart.start()
    }
  }

  Timer {
    id: restart
    interval: 10000
    onTriggered: bridge.running = true
  }

  // Moves the heart with `omarchy-bar move` (a widget plugin can't change the
  // bar layout itself). An argument list, never a shell string.
  Process {
    id: mover
    stderr: SplitParser { onRead: function (data) { console.warn("[spotify-like] bar move: " + data) } }
    onExited: function (exitCode) {
      if (exitCode !== 0) console.warn("[spotify-like] could not move the heart (exit " + exitCode + ")")
      var next = root.pendingMove
      root.pendingMove = null
      if (next && !MediaWidgets.adjacent(root.layout, root.heartId, next.target, next.side)) root.startMove(next)
    }
  }

  IpcHandler {
    target: "freezombie.spotify-like"

    function status(): string {
      return JSON.stringify(root.statusObject())
    }

    function like(): string {
      return root.setLiked(true) ? "ok" : "unhandled"
    }

    function unlike(): string {
      return root.setLiked(false) ? "ok" : "unhandled"
    }

    function toggle(): string {
      return root.setLiked(root.liked !== true) ? "ok" : "unhandled"
    }

    function place(side: string): string {
      return root.placeNow(side)
    }
  }
}
