import QtQuick
import Quickshell
import qs.Commons as Commons
import qs.Ui

// A heart next to the media widget. Filled and in the accent colour when the
// playing Spotify track is in Liked Songs. Left-click adds it; right-click
// removes it (so a stray click never unlikes a song). Hidden while the
// Spotify extension isn't connected or nothing likeable is playing, and
// otherwise shown and hidden the way the media widget next to it shows
// Spotify. Service.qml decides that, and keeps the heart next to the media
// widget, from the bar layout this widget reports.
BarWidget {
  id: root
  moduleName: "freezombie.spotify-like"

  readonly property var service: bar && bar.shell ? bar.shell.serviceFor(moduleName) : null
  readonly property bool hasTrack: service !== null && service.hasTrack === true
  readonly property bool liked: hasTrack && service.liked === true

  readonly property var layout: bar && bar.layoutConfig ? bar.layoutConfig : ({})
  onLayoutChanged: reportLayout()
  onServiceChanged: reportLayout()
  Component.onCompleted: reportLayout()

  function reportLayout() {
    if (service && typeof service.noteLayout === "function") service.noteLayout(layout)
  }

  visible: service !== null && service.showHeart === true
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
