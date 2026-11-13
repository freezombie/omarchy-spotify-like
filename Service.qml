import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Services.Mpris

// Runs bin/spotify-like-bridge once for the whole shell (the widget may be on
// several bars) and keeps the latest state it reports.
Item {
  id: root

  property var shell: null
  property var manifest: null

  property bool connected: false
  property string uri: ""
  property var liked: null
  property string lastError: ""

  // Spotify's MPRIS player, as media widgets see it. Whether the heart shows
  // while Spotify is Stopped (as it is right after it opens, until playback
  // starts) depends on the media widget next to it; BarWidget.qml decides.
  readonly property var players: Mpris.players ? Mpris.players.values : []
  readonly property var spotifyPlayer: findSpotifyPlayer()
  readonly property bool spotifyHasInfo: spotifyPlayer !== null
    && !!(spotifyPlayer.trackTitle || spotifyPlayer.trackArtist)
  readonly property bool spotifyStopped: spotifyPlayer !== null
    && spotifyPlayer.playbackState === MprisPlaybackState.Stopped

  // A likeable track Spotify also shows to media widgets.
  readonly property bool hasTrack: connected && uri !== "" && liked !== null && spotifyHasInfo
  readonly property var uriPattern: /^spotify:track:[A-Za-z0-9]{22}$/

  readonly property string bridgePath: {
    var path = String(Qt.resolvedUrl("bin/spotify-like-bridge"))
    return path.indexOf("file://") === 0 ? decodeURIComponent(path.substring(7)) : path
  }

  function findSpotifyPlayer() {
    for (var i = 0; i < players.length; i++) {
      var player = players[i]
      if (!player) continue
      var dbus = String(player.dbusName || "")
      if (dbus.indexOf("org.mpris.MediaPlayer2.spotify") === 0 || String(player.identity || "") === "Spotify") return player
    }
    return null
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
      spotifyHasInfo: spotifyHasInfo, spotifyStopped: spotifyStopped,
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
  }
}
