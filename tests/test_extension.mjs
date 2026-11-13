// Tests spicetify/spotify-like-bridge.js against a fake Spicetify and a fake
// WebSocket. Run: node tests/test_extension.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../spicetify/spotify-like-bridge.js", import.meta.url), "utf8");
const TRACK = "spotify:track:4uLU6hMCjMI75M1A2tKUQC";
const OTHER = "spotify:track:7ouMYWpwJ422jRcDASZB7P";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setup() {
  const library = new Set();
  const calls = [];
  const listeners = {};
  const sockets = [];
  class FakeSocket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(msg) { this.sent.push(JSON.parse(msg)); }
    open() { this.readyState = 1; this.onopen && this.onopen(); }
    deliver(obj) { this.onmessage && this.onmessage({ data: typeof obj === "string" ? obj : JSON.stringify(obj) }); }
  }
  const Spicetify = {
    Player: {
      data: { item: { uri: TRACK } },
      addEventListener: (name, fn) => { listeners[name] = fn; },
    },
    Platform: {
      LibraryAPI: {
        contains: async (uri) => [library.has(uri)],
        add: async ({ uris }) => { calls.push(["add", ...uris]); uris.forEach((u) => library.add(u)); },
        remove: async ({ uris }) => { calls.push(["remove", ...uris]); uris.forEach((u) => library.delete(u)); },
      },
    },
  };
  const timers = [];
  const context = {
    window: {}, Spicetify, WebSocket: FakeSocket, console,
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 20)),
    setInterval: (fn) => { timers.push(fn); return 0; },
  };
  context.window.Spicetify = Spicetify;
  vm.runInNewContext(source, context);
  return { Spicetify, library, calls, listeners, sockets, heartbeat: () => timers.forEach((f) => f()) };
}

const t = setup();
assert.equal(t.sockets.length, 1);
assert.equal(t.sockets[0].url, "ws://127.0.0.1:47851");
const ws = t.sockets[0];
ws.open();
await sleep(30);
assert.deepEqual(ws.sent.at(-1), { type: "state", uri: TRACK, liked: false });

// Like the playing track.
ws.deliver({ type: "set", uri: TRACK, liked: true });
await sleep(60);
assert.deepEqual(t.calls, [["add", TRACK]]);
assert.deepEqual(ws.sent.at(-1), { type: "state", uri: TRACK, liked: true });

// A stale command for another track is ignored and the real state re-sent.
ws.deliver({ type: "set", uri: OTHER, liked: true });
await sleep(30);
assert.deepEqual(t.calls, [["add", TRACK]]);

// Malformed commands are ignored.
for (const bad of ["not json", { type: "set", uri: TRACK, liked: "false" }, { type: "eval", code: "x" },
                   { type: "set", uri: "spotify:track:" + "A".repeat(23), liked: false }]) {
  ws.deliver(bad);
}
await sleep(30);
assert.deepEqual(t.calls, [["add", TRACK]]);

// Unlike.
ws.deliver({ type: "set", uri: TRACK, liked: false });
await sleep(60);
assert.deepEqual(t.calls.at(-1), ["remove", TRACK]);

// Podcast episode / nothing playing: reported as no track.
t.Spicetify.Player.data.item = { uri: "spotify:episode:4uLU6hMCjMI75M1A2tKUQC" };
t.listeners.songchange();
await sleep(30);
assert.deepEqual(ws.sent.at(-1), { type: "state", uri: "", liked: null });

// Heartbeat always sends, even when nothing changed.
const before = ws.sent.length;
t.heartbeat();
await sleep(30);
assert.equal(ws.sent.length, before + 1);

// Reconnects after the bridge goes away.
ws.readyState = 3;
ws.onclose();
await sleep(40);
assert.equal(t.sockets.length, 2);

console.log("extension tests passed");
