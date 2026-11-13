import QtQuick
import Quickshell
import qs.Commons as Commons
import qs.Ui

// A heart next to the media widget. Filled and in the accent colour when the
// playing Spotify track is in Liked Songs. Left-click adds it; right-click
// removes it (so a stray click never unlikes a song). Hidden while the
// Spotify extension isn't connected or nothing likeable is playing, and
// otherwise shown and hidden the way the media widget next to it shows
// Spotify (see showWhenStopped).
BarWidget {
  id: root
  moduleName: "freezombie.spotify-like"

  readonly property var service: bar && bar.shell ? bar.shell.serviceFor(moduleName) : null
  readonly property bool hasTrack: service !== null && service.hasTrack === true
  readonly property bool liked: hasTrack && service.liked === true

  // Media widgets differ on a Spotify that is Stopped but has a song loaded
  // (right after it opens): crmne.mpris hides it, Omarchy's built-in
  // omarchy.media shows it. Follow the one in this bar; the
  // "showWhenStopped" setting in shell.json overrides the guess.
  readonly property var layout: bar && bar.layoutConfig ? bar.layoutConfig : ({})
  // `omarchy bar set … showWhenStopped true` stores the string "true"; with
  // --json it's a boolean. Accept both.
  readonly property string showWhenStoppedSetting: String(setting("showWhenStopped", ""))
  readonly property bool showWhenStopped: showWhenStoppedSetting === "true" || showWhenStoppedSetting === "false"
    ? showWhenStoppedSetting === "true"
    : layoutHas("omarchy.media") && !layoutHas("crmne.mpris")

  function layoutHas(id) {
    for (var section in layout) {
      var entries = layout[section]
      if (!Array.isArray(entries)) continue
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i]
        var entryId = entry && typeof entry === "object" ? entry.id : entry
        if (String(entryId || "") === id) return true
      }
    }
    return false
  }

  visible: hasTrack && (service.spotifyStopped !== true || showWhenStopped)
  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.liked ? "\uf004" : "\uf08a"
    slotSize: Commons.Style.bar.statusSlot
    foreground: root.liked
      ? Commons.Color.accent
      : (root.bar ? root.bar.barForeground : Commons.Color.foreground)
    useActiveColor: false
    pressFeedbackButtons: Qt.LeftButton | Qt.RightButton
    tooltipText: root.liked ? "In Liked Songs (right-click to remove)" : "Add to Liked Songs"
    onPressed: function (pressedButton) {
      if (!root.service) return
      if (pressedButton === Qt.RightButton) {
        if (root.liked) root.service.setLiked(false)
      } else if (!root.liked) {
        root.service.setLiked(true)
      }
    }
  }
}
