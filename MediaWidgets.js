.pragma library

// The media widget next to the heart, read from the bar layout: which one it
// is, how it shows a Spotify that isn't playing, and where the heart belongs.
// Pure functions, so tests/test_media_widgets.mjs can run them in node.

var HEART_ID = "freezombie.spotify-like"
var ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
var SIDES = ["after", "before"]
// When the heart hides: "never" (whenever a song is loaded), "stopped"
// (while Spotify is stopped, as it is right after it opens until you press
// play) or "paused" (whenever Spotify isn't playing).
var RULES = ["never", "stopped", "paused"]

function isTrue(value) {
  return value === true || String(value).toLowerCase() === "true"
}

// Media widgets from the plugin marketplace (checked 2026-11-13) and how each
// one shows a Spotify that is stopped with a song loaded. The first one in
// this order that is in the bar is the one the heart follows.
var KNOWN = [
  { id: "crmne.mpris", rule: function () { return "stopped" } },
  {
    id: "io.github.qempexe.omaudix",
    rule: function (entry) { return RULES.indexOf(entry.hideWhen) !== -1 ? entry.hideWhen : "stopped" }
  },
  {
    id: "io.github.erikburdett.wavebar",
    rule: function (entry) { return isTrue(entry.hideWhenPaused) ? "paused" : "never" }
  },
  { id: "omarchy.media" },
  { id: "now-playing" },
  { id: "custom.media" },
  { id: "io.github.elliotalien.tide" },
  { id: "nenadjokic.navibeat" },
  { id: "lancefaul.omedia-controls" },
  { id: "bibek.media" },
  { id: "io.github.joshz7.afterglow" },
  { id: "celestune-bar" }
]

function isValidId(id) {
  return typeof id === "string" && ID_PATTERN.test(id)
}

function entryId(entry) {
  var id = entry && typeof entry === "object" ? entry.id : entry
  return typeof id === "string" ? id : ""
}

// Every widget in the layout: {id, section, index, entry}.
function entries(layout) {
  var out = []
  if (!layout || typeof layout !== "object") return out
  for (var section in layout) {
    var list = layout[section]
    if (!Array.isArray(list)) continue
    for (var i = 0; i < list.length; i++) {
      var id = entryId(list[i])
      if (!id) continue
      var entry = list[i] && typeof list[i] === "object" ? list[i] : { id: id }
      out.push({ id: id, section: section, index: i, entry: entry })
    }
  }
  return out
}

function entryFor(layout, id) {
  var list = entries(layout)
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i]
  }
  return null
}

function knownWidget(id) {
  for (var i = 0; i < KNOWN.length; i++) {
    if (KNOWN[i].id === id) return KNOWN[i]
  }
  return null
}

// The media widget the heart follows: the mediaWidget setting when that
// widget is in the bar, otherwise the first known one in the bar.
function detectMedia(layout, override) {
  if (isValidId(override) && override !== HEART_ID) {
    var chosen = entryFor(layout, override)
    if (chosen) return chosen
  }
  for (var i = 0; i < KNOWN.length; i++) {
    var hit = entryFor(layout, KNOWN[i].id)
    if (hit) return hit
  }
  return null
}

// The heart's own hideWhen setting wins; "auto" or nothing follows the media
// widget; an unknown widget shows Spotify like most do.
function hideRule(media, heartEntry) {
  var own = heartEntry ? String(heartEntry.hideWhen === undefined || heartEntry.hideWhen === null ? "" : heartEntry.hideWhen) : ""
  if (RULES.indexOf(own) !== -1) return own
  var known = media ? knownWidget(media.id) : null
  if (known && known.rule) return known.rule(media.entry || {})
  return "never"
}

// "after" or "before"; anything else (unset, "manual") means don't move it.
function placementOf(heartEntry) {
  var value = heartEntry ? String(heartEntry.placement || "") : ""
  return SIDES.indexOf(value) !== -1 ? value : ""
}

function adjacent(layout, heartId, mediaId, side) {
  var heart = entryFor(layout, heartId)
  var media = entryFor(layout, mediaId)
  if (!heart || !media || heart.section !== media.section) return false
  return side === "before" ? heart.index === media.index - 1 : heart.index === media.index + 1
}

// Where a widget sits with another one left out, so that moving one of the
// two doesn't look like the other one moved.
function signature(layout, id, without) {
  if (!id || !layout || typeof layout !== "object") return ""
  for (var section in layout) {
    var list = layout[section]
    if (!Array.isArray(list)) continue
    var position = 0
    for (var i = 0; i < list.length; i++) {
      var current = entryId(list[i])
      if (!current || current === without) continue
      if (current === id) return section + ":" + position
      position++
    }
  }
  return ""
}

// One step of keeping the heart next to the media widget. Moves it only when
// the media widget changed or moved, or the placement setting changed; a heart
// dragged away from an unmoved media widget stays where it was put. The first
// call only records the layout. options: {force, side} for an explicit request.
// Returns {state, move: null | {side, target}}.
function placementStep(state, layout, heartId, options) {
  var prev = state || {}
  var opts = options || {}
  var heart = entryFor(layout, heartId)
  var media = detectMedia(layout, heart ? heart.entry.mediaWidget : "")
  var mediaId = media ? media.id : ""
  var placement = placementOf(heart ? heart.entry : null)
  var next = {
    primed: true,
    media: mediaId,
    mediaSig: mediaId ? signature(layout, mediaId, heartId) : "",
    heartSig: heart ? signature(layout, heartId, mediaId) : "",
    placement: placement,
    detached: false
  }
  var side = SIDES.indexOf(opts.side) !== -1 ? opts.side : placement
  if (!prev.primed && !opts.force) return { state: next, move: null }

  var mediaChanged = mediaId !== prev.media
  var mediaMoved = !mediaChanged && next.mediaSig !== prev.mediaSig
  var placementChanged = placement !== prev.placement
  var heartMoved = !mediaChanged && !mediaMoved && next.heartSig !== prev.heartSig
  var inPlace = !!(heart && media && placement && adjacent(layout, heartId, mediaId, placement))

  if (opts.force || placementChanged || inPlace) next.detached = false
  else if (heartMoved) next.detached = true
  else next.detached = !!prev.detached

  var trigger = !!opts.force || placementChanged || mediaChanged || mediaMoved
  var move = null
  if (trigger && !next.detached && side && heart && media && isValidId(mediaId)
      && !adjacent(layout, heartId, mediaId, side)) {
    move = { side: side, target: mediaId }
  }
  return { state: next, move: move }
}
