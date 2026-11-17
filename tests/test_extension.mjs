// Tests spicetify/spotify-like-bridge.js against a fake Spicetify and a fake
// WebSocket. Run: node tests/test_extension.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createHmac, randomBytes, webcrypto } from "node:crypto";

const template = readFileSync(new URL("../spicetify/spotify-like-bridge.js", import.meta.url), "utf8");
const SECRET = "0123456789abcdef".repeat(4);
assert.ok(template.includes('"@SPOTIFY_LIKE_SECRET@"'), "the template keeps the placeholder");
const source = template.replace("@SPOTIFY_LIKE_SECRET@", SECRET);
const proof = (secret, role, a, b) => createHmac("sha256", secret).update(`${role} ${a} ${b}`).digest("hex");
const TRACK = "spotify:track:4uLU6hMCjMI75M1A2tKUQC";
const OTHER = "spotify:track:7ouMYWpwJ422jRcDASZB7P";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(code = source) {
  const library = new Set();
  const calls = [];
  const listeners = {};
  const sockets = [];
  class FakeSocket {
    static OPEN = 1;
    constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(msg) { this.sent.push(JSON.parse(msg)); }
    close() { this.closed = true; }
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
  const warnings = [];
  const context = {
    window: { crypto: webcrypto }, Spicetify, WebSocket: FakeSocket, TextEncoder,
    console: { warn: (...a) => warnings.push(a.join(" ")), log: console.log },
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 20)),
    setInterval: (fn) => { timers.push(fn); return 0; },
  };
  context.window.Spicetify = Spicetify;
  vm.runInNewContext(code, context);
  return { Spicetify, library, calls, listeners, sockets, warnings, heartbeat: () => timers.forEach((f) => f()) };
}

// Plays the bridge's side of the handshake; returns the server nonce.
async function handshake(ws, secret = SECRET) {
  ws.open();
  const hello = ws.sent.at(-1);
  assert.equal(hello.type, "hello");
  assert.match(hello.nonce, /^[0-9a-f]{32}$/);
  const nonce = randomBytes(16).toString("hex");
  ws.deliver({ type: "hello", nonce, proof: proof(secret, "server", hello.nonce, nonce) });
  await sleep(30);
  return { client: hello.nonce, server: nonce };
}

// No secret filled in (the plugin's own template): never connects.
{
  const t0 = setup(template);
  await sleep(30);
  assert.equal(t0.sockets.length, 0);
  assert.match(t0.warnings.join("\n"), /setup\/install/);
}

// A server that doesn't know the secret gets nothing: no state, no auth,
// commands ignored, connection closed.
{
  const t1 = setup();
  const w = t1.sockets[0];
  await handshake(w, "f".repeat(64));
  assert.deepEqual(w.sent.map((m) => m.type), ["hello"]);
  w.deliver({ type: "set", uri: TRACK, liked: true });
  t1.heartbeat();
  await sleep(60);
  assert.deepEqual(t1.calls, []);
  assert.deepEqual(w.sent.map((m) => m.type), ["hello"]);
  assert.ok(w.closed);
  assert.match(t1.warnings.join("\n"), /did not prove/);
}

// Before the server's hello, nothing is sent or applied.
{
  const t2 = setup();
  const w = t2.sockets[0];
  w.open();
  w.deliver({ type: "set", uri: TRACK, liked: true });
  t2.heartbeat();
  await sleep(60);
  assert.deepEqual(t2.calls, []);
  assert.deepEqual(w.sent.map((m) => m.type), ["hello"]);
  assert.ok(w.closed, "a non-hello answer closes the connection");
}

const t = setup();
assert.equal(t.sockets.length, 1);
assert.equal(t.sockets[0].url, "ws://127.0.0.1:47851");
const ws = t.sockets[0];
const nonces = await handshake(ws);
assert.deepEqual(ws.sent[1], { type: "auth", proof: proof(SECRET, "client", nonces.server, nonces.client) });
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

assert.ok(!ws.closed, "an authenticated connection stays open past the auth timeout");

// Reconnects after the bridge goes away.
ws.readyState = 3;
ws.onclose();
await sleep(40);
assert.equal(t.sockets.length, 2);

console.log("extension tests passed");
