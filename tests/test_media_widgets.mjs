// Tests MediaWidgets.js (media widget detection, hide rules, placement).
// Run: node tests/test_media_widgets.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// QML's ".pragma library" line isn't JavaScript; everything else is plain ES5.
const source = readFileSync(new URL("../MediaWidgets.js", import.meta.url), "utf8")
  .replace(/^\.pragma library\s*$/m, "");
const M = vm.runInNewContext(source + "\n;({ KNOWN, isValidId, entries, entryFor, detectMedia, hideRule, placementOf, adjacent, placementStep })");

const HEART = "freezombie.spotify-like";
const heart = (settings = {}) => ({ id: HEART, ...settings });
const ids = (list) => list.map((e) => (typeof e === "string" ? { id: e } : e));
const layoutOf = (sections) => {
  const out = { left: [], centerBegin: [], center: [], centerEnd: [], right: [] };
  for (const [k, v] of Object.entries(sections)) out[k] = ids(v);
  return out;
};
let failures = 0;
function test(name, fn) {
  try { fn(); console.log("ok   " + name); } catch (e) { failures++; console.log("FAIL " + name + "\n     " + e.message); }
}

// --- detection -------------------------------------------------------------

test("crmne.mpris wins over omarchy.media", () => {
  const l = layoutOf({ centerBegin: ["omarchy.media"], centerEnd: ["crmne.mpris", heart()] });
  assert.equal(M.detectMedia(l, "").id, "crmne.mpris");
});

test("omarchy.media alone is found, with its section and index", () => {
  const m = M.detectMedia(layoutOf({ centerBegin: ["omarchy.clock", "omarchy.media"] }), "");
  assert.equal(m.id, "omarchy.media");
  assert.equal(m.section, "centerBegin");
  assert.equal(m.index, 1);
});

test("string entries count too", () => {
  const l = { centerEnd: ["now-playing"] };
  assert.equal(M.detectMedia(l, "").id, "now-playing");
});

test("mediaWidget override wins when it's in the bar", () => {
  const l = layoutOf({ centerEnd: ["crmne.mpris", "me.media", heart()] });
  assert.equal(M.detectMedia(l, "me.media").id, "me.media");
});

test("override not in the bar falls back to known widgets", () => {
  const l = layoutOf({ centerEnd: ["crmne.mpris"] });
  assert.equal(M.detectMedia(l, "me.media").id, "crmne.mpris");
});

test("invalid or self override is ignored", () => {
  const l = layoutOf({ centerEnd: ["crmne.mpris", heart(), "--evil"] });
  assert.equal(M.detectMedia(l, "--evil").id, "crmne.mpris");
  assert.equal(M.detectMedia(l, HEART).id, "crmne.mpris");
  assert.equal(M.isValidId("--after"), false);
  assert.equal(M.isValidId("a b"), false);
  assert.equal(M.isValidId("io.github.x.y-z_1"), true);
});

test("no media widget: null", () => {
  assert.equal(M.detectMedia(layoutOf({ right: ["omarchy.audio", heart()] }), ""), null);
  assert.equal(M.detectMedia(null, ""), null);
});

test("Spotify widgets with their own heart are not followed", () => {
  const l = layoutOf({ left: ["quickshell.spotify", "io.github.jeremylanger.omaspotify"] });
  assert.equal(M.detectMedia(l, ""), null);
});

// --- hide rules --------------------------------------------------------------

const rule = (sections, own = {}) => {
  const l = layoutOf(sections);
  const h = M.entryFor(l, HEART);
  return M.hideRule(M.detectMedia(l, h ? h.entry.mediaWidget : ""), h ? h.entry : own);
};

test("crmne.mpris hides while stopped", () => {
  assert.equal(rule({ centerEnd: ["crmne.mpris", heart()] }), "stopped");
});

test("omarchy.media and other widgets show a stopped Spotify", () => {
  assert.equal(rule({ centerBegin: ["omarchy.media"], centerEnd: [heart()] }), "never");
  assert.equal(rule({ centerEnd: ["lancefaul.omedia-controls", heart()] }), "never");
});

test("omaudix follows its hideWhen setting, default stopped", () => {
  assert.equal(rule({ left: ["io.github.qempexe.omaudix", heart()] }), "stopped");
  assert.equal(rule({ left: [{ id: "io.github.qempexe.omaudix", hideWhen: "paused" }, heart()] }), "paused");
  assert.equal(rule({ left: [{ id: "io.github.qempexe.omaudix", hideWhen: "never" }, heart()] }), "never");
  assert.equal(rule({ left: [{ id: "io.github.qempexe.omaudix", hideWhen: "bogus" }, heart()] }), "stopped");
});

test("wavebar hideWhenPaused (string or boolean)", () => {
  assert.equal(rule({ left: ["io.github.erikburdett.wavebar", heart()] }), "never");
  assert.equal(rule({ left: [{ id: "io.github.erikburdett.wavebar", hideWhenPaused: "true" }, heart()] }), "paused");
  assert.equal(rule({ left: [{ id: "io.github.erikburdett.wavebar", hideWhenPaused: true }, heart()] }), "paused");
});

test("unknown widget or none: never", () => {
  assert.equal(rule({ centerEnd: ["me.media", heart()] }), "never");
  assert.equal(rule({ right: [heart()] }), "never");
});

test("the heart's own hideWhen wins; auto follows the widget", () => {
  assert.equal(rule({ centerEnd: ["crmne.mpris", heart({ hideWhen: "never" })] }), "never");
  assert.equal(rule({ centerBegin: ["omarchy.media"], centerEnd: [heart({ hideWhen: "paused" })] }), "paused");
  assert.equal(rule({ centerEnd: ["crmne.mpris", heart({ hideWhen: "auto" })] }), "stopped");
});

test("placementOf: after/before, anything else is manual", () => {
  assert.equal(M.placementOf({ placement: "after" }), "after");
  assert.equal(M.placementOf({ placement: "before" }), "before");
  assert.equal(M.placementOf({ placement: "manual" }), "");
  assert.equal(M.placementOf({}), "");
  assert.equal(M.placementOf(null), "");
});

// --- placement ---------------------------------------------------------------

// Runs layouts through placementStep in order; returns each step's move.
function run(layouts, start = {}) {
  let state = start;
  return layouts.map((l) => {
    const r = M.placementStep(state, layoutOf(l), HEART, {});
    state = r.state;
    return r.move;
  }).concat([state]);
}

test("first layout only records, even when out of place", () => {
  const [move, state] = run([{ centerBegin: ["omarchy.media"], centerEnd: [heart({ placement: "after" })] }]);
  assert.equal(move, null);
  assert.equal(state.primed, true);
});

test("setting placement (install) moves it after the media widget", () => {
  const [m1, m2] = run([
    { centerEnd: [heart(), "omarchy.clock", "crmne.mpris"] },
    { centerEnd: [heart({ placement: "after" }), "omarchy.clock", "crmne.mpris"] },
  ]);
  assert.equal(m1, null);
  assert.deepEqual({ ...m2 }, { side: "after", target: "crmne.mpris" });
});

test("before puts it on the left", () => {
  const [, m] = run([
    { centerEnd: ["crmne.mpris", heart()] },
    { centerEnd: ["crmne.mpris", heart({ placement: "before" })] },
  ]);
  assert.deepEqual({ ...m }, { side: "before", target: "crmne.mpris" });
});

test("already adjacent: no move", () => {
  const [, m] = run([
    { centerEnd: ["crmne.mpris", heart()] },
    { centerEnd: ["crmne.mpris", heart({ placement: "after" })] },
  ]);
  assert.equal(m, null);
});

test("switching media widget follows it to its section", () => {
  const h = heart({ placement: "after" });
  const [, m] = run([
    { centerEnd: ["crmne.mpris", h] },
    { centerBegin: ["omarchy.media"], centerEnd: [h] },
  ]);
  assert.deepEqual({ ...m }, { side: "after", target: "omarchy.media" });
});

test("media widget dragged: the heart follows", () => {
  const h = heart({ placement: "after" });
  const [, m] = run([
    { centerEnd: ["crmne.mpris", h, "omarchy.system-update"] },
    { left: ["crmne.mpris"], centerEnd: [h, "omarchy.system-update"] },
  ]);
  assert.deepEqual({ ...m }, { side: "after", target: "crmne.mpris" });
});

test("heart dragged away stays; later media shifts don't pull it back", () => {
  const h = heart({ placement: "after" });
  const out = run([
    { centerEnd: ["crmne.mpris", h, "omarchy.system-update"] },
    { centerEnd: ["crmne.mpris", "omarchy.system-update"], right: [h] },            // user drags the heart
    { centerEnd: ["omarchy.weather", "crmne.mpris", "omarchy.system-update"], right: [h] }, // media index shifts
    { centerBegin: ["omarchy.media"], centerEnd: ["omarchy.system-update"], right: [h] },  // media switched
  ]);
  assert.deepEqual(out.slice(0, 4), [null, null, null, null]);
  assert.equal(out[4].detached, true);
});

test("dragging the heart back next to it re-attaches it", () => {
  const h = heart({ placement: "after" });
  const out = run([
    { centerEnd: ["crmne.mpris", h] },
    { centerEnd: ["crmne.mpris"], right: [h] },
    { centerEnd: ["crmne.mpris", h] },
    { left: ["crmne.mpris"], centerEnd: [h] },  // now the media widget moves
  ]);
  assert.equal(out[2], null);
  assert.deepEqual({ ...out[3] }, { side: "after", target: "crmne.mpris" });
});

test("changing placement after a drag places it again", () => {
  const out = run([
    { centerEnd: ["crmne.mpris", heart({ placement: "after" })] },
    { centerEnd: ["crmne.mpris"], right: [heart({ placement: "after" })] },
    { centerEnd: ["crmne.mpris"], right: [heart({ placement: "before" })] },
  ]);
  assert.deepEqual({ ...out[2] }, { side: "before", target: "crmne.mpris" });
});

test("manual or unset placement never moves", () => {
  for (const p of [undefined, "manual", "bogus"]) {
    const h = heart(p === undefined ? {} : { placement: p });
    const out = run([
      { centerEnd: ["crmne.mpris", h] },
      { centerBegin: ["omarchy.media"], centerEnd: [h] },
      { left: ["omarchy.media"], centerEnd: [h] },
    ]);
    assert.deepEqual(out.slice(0, 3), [null, null, null], String(p));
  }
});

test("the same layout again (e.g. after a failed move) doesn't move again", () => {
  const h = heart({ placement: "after" });
  const out = run([
    { centerEnd: ["crmne.mpris", h] },
    { left: ["crmne.mpris"], centerEnd: [h] },
    { left: ["crmne.mpris"], centerEnd: [h] },
  ]);
  assert.notEqual(out[1], null);
  assert.equal(out[2], null);
});

test("no media widget or heart not on the bar: no move", () => {
  const out = run([
    { right: [heart({ placement: "after" })] },
    { right: ["omarchy.audio", heart({ placement: "after" })] },
    { centerEnd: ["crmne.mpris"] },
  ]);
  assert.deepEqual(out.slice(0, 3), [null, null, null]);
});

test("forced place uses the given side, even when detached or unprimed", () => {
  const l = layoutOf({ centerEnd: ["crmne.mpris"], right: [heart({ placement: "after" })] });
  const r1 = M.placementStep({}, l, HEART, { force: true, side: "before" });
  assert.deepEqual({ ...r1.move }, { side: "before", target: "crmne.mpris" });
  const r2 = M.placementStep({ primed: true, detached: true, media: "crmne.mpris", mediaSig: "centerEnd:0", heartSig: "right:0", placement: "after" }, l, HEART, { force: true, side: "" });
  assert.deepEqual({ ...r2.move }, { side: "after", target: "crmne.mpris" });
  assert.equal(r2.state.detached, false);
});

test("adjacent checks the side and the section", () => {
  const l = layoutOf({ centerBegin: [heart()], centerEnd: ["crmne.mpris"] });
  assert.equal(M.adjacent(l, HEART, "crmne.mpris", "before"), false);
  const l2 = layoutOf({ centerEnd: [heart(), "crmne.mpris"] });
  assert.equal(M.adjacent(l2, HEART, "crmne.mpris", "before"), true);
  assert.equal(M.adjacent(l2, HEART, "crmne.mpris", "after"), false);
});

if (failures) {
  console.log(`${failures} test(s) failed`);
  process.exit(1);
}
console.log("media widget tests passed");
