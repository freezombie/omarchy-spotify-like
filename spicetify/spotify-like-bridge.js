// spotify-like-bridge: reports the playing track's Liked Songs state to the
// Omarchy bar and applies like/unlike requests from it.
//
// Talks only to ws://127.0.0.1:47851 (the bar's bridge). Sends nothing else
// anywhere. Accepts only {"type":"set","uri":"spotify:track:<22 chars>","liked":bool},
// and only for the track that is playing right now.
//
// Before it sends anything or accepts a command, the server must prove it
// knows the per-install secret (HMAC-SHA256 challenge-response, see
// bin/spotify-like-bridge), so a process of another local user that takes the
// port first gets nothing. setup/install writes the secret into the copy of
// this file it gives Spicetify; this template in the plugin has a placeholder.
(function spotifyLikeBridge() {
  if (!window.Spicetify || !Spicetify.Player || !Spicetify.Player.data
      || !Spicetify.Platform || !Spicetify.Platform.LibraryAPI) {
    setTimeout(spotifyLikeBridge, 500);
    return;
  }

  const URL = "ws://127.0.0.1:47851";
  const URI_RE = /^spotify:track:[A-Za-z0-9]{22}$/;
  const HEARTBEAT_MS = 5000;
  const RETRY_MS = 5000;
  const AUTH_TIMEOUT_MS = 5000;
  const Library = Spicetify.Platform.LibraryAPI;
  const SECRET = "@SPOTIFY_LIKE_SECRET@";
  const subtle = window.crypto && window.crypto.subtle;
  const enc = new TextEncoder();

  if (!/^[0-9a-f]{64}$/.test(SECRET)) {
    console.warn("[spotify-like-bridge] no secret in this copy; run the plugin's setup/install");
    return;
  }
  if (!subtle) {
    console.warn("[spotify-like-bridge] WebCrypto is not available; not connecting");
    return;
  }
  const keyPromise = subtle.importKey("raw", enc.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);

  let socket = null;
  let lastSent = "";
  // Per connection: "hello" (waiting for the server's proof), then "ready".
  let phase = "";
  let myNonce = "";

  function hex(bytes) {
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function proof(role, first, second) {
    const key = await keyPromise;
    return hex(await subtle.sign("HMAC", key, enc.encode(role + " " + first + " " + second)));
  }

  function currentUri() {
    const item = Spicetify.Player.data && Spicetify.Player.data.item;
    const uri = item && typeof item.uri === "string" ? item.uri : "";
    return URI_RE.test(uri) ? uri : "";
  }

  async function likedState(uri) {
    if (!uri) return null;
    try {
      const [added] = await Library.contains(uri);
      return added === true;
    } catch (e) {
      return null;
    }
  }

  async function report(force) {
    if (!socket || socket.readyState !== WebSocket.OPEN || phase !== "ready") return;
    const uri = currentUri();
    const liked = await likedState(uri);
    const msg = JSON.stringify({ type: "state", uri: liked === null ? "" : uri, liked });
    // The heartbeat always goes out, so the bridge knows we're alive.
    if (force || msg !== lastSent) {
      lastSent = msg;
      socket.send(msg);
    }
  }

  async function serverHello(ws, msg) {
    if (!msg || msg.type !== "hello" || typeof msg.nonce !== "string" || !/^[0-9a-f]{32}$/.test(msg.nonce)
        || typeof msg.proof !== "string") {
      ws.close();
      return;
    }
    const expected = await proof("server", myNonce, msg.nonce);
    if (ws !== socket) return;
    if (msg.proof !== expected) {
      console.warn("[spotify-like-bridge] the server on " + URL + " did not prove the secret; not talking to it");
      ws.close();
      return;
    }
    ws.send(JSON.stringify({ type: "auth", proof: await proof("client", msg.nonce, myNonce) }));
    phase = "ready";
    lastSent = "";
    report(true);
  }

  async function onMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (ws !== socket) return;
    if (phase === "hello") { serverHello(ws, msg); return; }
    if (phase === "ready") apply(msg);
  }

  async function apply(msg) {
    if (!msg || msg.type !== "set" || typeof msg.uri !== "string"
        || !URI_RE.test(msg.uri) || typeof msg.liked !== "boolean") return;
    // Only ever change the track that's playing, so a stale click can't hit
    // a different song.
    if (msg.uri !== currentUri()) { report(true); return; }
    try {
      if (msg.liked) await Library.add({ uris: [msg.uri] });
      else await Library.remove({ uris: [msg.uri] });
    } catch (e) {
      console.warn("[spotify-like-bridge] library change failed", e);
    }
    setTimeout(() => report(true), 300);
  }

  function connect() {
    let ws;
    try {
      ws = new WebSocket(URL);
    } catch (e) {
      setTimeout(connect, RETRY_MS);
      return;
    }
    socket = ws;
    phase = "";
    ws.onopen = () => {
      phase = "hello";
      myNonce = hex(window.crypto.getRandomValues(new Uint8Array(16)));
      ws.send(JSON.stringify({ type: "hello", nonce: myNonce }));
      setTimeout(() => { if (socket === ws && phase !== "ready") ws.close(); }, AUTH_TIMEOUT_MS);
    };
    ws.onmessage = (event) => { if (typeof event.data === "string") onMessage(ws, event.data); };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      phase = "";
      setTimeout(connect, RETRY_MS);
    };
    ws.onerror = () => { /* onclose follows and retries */ };
  }

  Spicetify.Player.addEventListener("songchange", () => setTimeout(() => report(false), 300));
  // Likes made in the app itself show up on the next heartbeat.
  setInterval(() => report(true), HEARTBEAT_MS);
  connect();
})();
