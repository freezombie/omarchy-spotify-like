import QtQuick
import Quickshell
import qs.Commons as Commons
import qs.Ui

// A heart next to the media widget. Filled and in the accent colour when the
// playing Spotify track is in Liked Songs. Left-click adds it; right-click
// removes it (so a stray click never unlikes a song). Hidden while the
// Spotify extension isn't connected or nothing likeable is playing.
BarWidget {
  id: root
  moduleName: "freezombie.spotify-like"

  readonly property var service: bar && bar.shell ? bar.shell.serviceFor(moduleName) : null
  readonly property bool hasTrack: service !== null && service.hasTrack === true
  readonly property bool liked: hasTrack && service.liked === true

  visible: hasTrack
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
