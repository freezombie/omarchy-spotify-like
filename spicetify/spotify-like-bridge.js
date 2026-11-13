// spotify-like-bridge: reports the playing track's Liked Songs state to the
// Omarchy bar and applies like/unlike requests from it.
//
// Talks only to ws://127.0.0.1:47851 (the bar's bridge). Sends nothing else
// anywhere. Accepts only {"type":"set","uri":"spotify:track:<22 chars>","liked":bool},
// and only for the track that is playing right now.
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
  const Library = Spicetify.Platform.LibraryAPI;

  let socket = null;
  let lastSent = "";

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
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const uri = currentUri();
    const liked = await likedState(uri);
    const msg = JSON.stringify({ type: "state", uri: liked === null ? "" : uri, liked });
    // The heartbeat always goes out, so the bridge knows we're alive.
    if (force || msg !== lastSent) {
      lastSent = msg;
      socket.send(msg);
    }
  }

  async function apply(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
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
    try {
      socket = new WebSocket(URL);
    } catch (e) {
      setTimeout(connect, RETRY_MS);
      return;
    }
    socket.onopen = () => { lastSent = ""; report(true); };
    socket.onmessage = (event) => { if (typeof event.data === "string") apply(event.data); };
    socket.onclose = () => { socket = null; setTimeout(connect, RETRY_MS); };
    socket.onerror = () => { /* onclose follows and retries */ };
  }

  Spicetify.Player.addEventListener("songchange", () => setTimeout(() => report(false), 300));
  // Likes made in the app itself show up on the next heartbeat.
  setInterval(() => report(true), HEARTBEAT_MS);
  connect();
})();
