"""Tests for bin/spotify-like-bridge, with a fake Spotify extension client.

Run: /usr/bin/python3 -I -m unittest discover -s tests
"""

import base64
import json
import os
import pathlib
import random
import select
import socket
import struct
import subprocess
import time
import unittest

BRIDGE = pathlib.Path(__file__).resolve().parent.parent / "bin" / "spotify-like-bridge"
ORIGIN = "https://xpui.app.spotify.com"
TRACK = "spotify:track:4uLU6hMCjMI75M1A2tKUQC"
OTHER = "spotify:track:7ouMYWpwJ422jRcDASZB7P"


class Bridge:
    def __init__(self):
        self.port = random.randint(40000, 60000)
        env = dict(os.environ, SPOTIFY_LIKE_PORT=str(self.port))
        self.proc = subprocess.Popen(
            ["/usr/bin/python3", "-I", str(BRIDGE)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=env, text=True, bufsize=1,
        )
        first = self.read()
        assert first == {"type": "state", "connected": False, "uri": "", "liked": None}, first

    def read(self, timeout=3.0):
        ready, _, _ = select.select([self.proc.stdout], [], [], timeout)
        if not ready:
            return None
        return json.loads(self.proc.stdout.readline())

    def command(self, line):
        self.proc.stdin.write(line + "\n")
        self.proc.stdin.flush()

    def close(self):
        self.proc.stdin.close()
        try:
            self.proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        self.proc.stdout.close()
        self.proc.stderr.close()


class Client:
    def __init__(self, port, origin=ORIGIN, host=None):
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=3)
        key = base64.b64encode(os.urandom(16)).decode()
        host = host or f"127.0.0.1:{port}"
        self.sock.sendall(
            (
                "GET / HTTP/1.1\r\n"
                f"Host: {host}\r\n"
                "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n"
                f"Origin: {origin}\r\n\r\n"
            ).encode()
        )
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(1024)
            if not chunk:
                break
            buf += chunk
        self.status = buf.split(b"\r\n", 1)[0].decode()

    def send_raw(self, opcode, payload, masked=True):
        header = bytes([0x80 | opcode])
        n = len(payload)
        lenbyte = n if n < 126 else 126
        header += bytes([(0x80 if masked else 0) | lenbyte])
        if n >= 126:
            header += struct.pack("!H", n)
        if masked:
            mask = os.urandom(4)
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            header += mask
        self.sock.sendall(header + payload)

    def send(self, obj):
        self.send_raw(0x1, json.dumps(obj).encode())

    def recv(self):
        b1, b2 = self.sock.recv(2)
        n = b2 & 0x7F
        if n == 126:
            (n,) = struct.unpack("!H", self.sock.recv(2))
        data = b""
        while len(data) < n:
            data += self.sock.recv(n - len(data))
        return b1 & 0x0F, data

    def is_closed(self):
        try:
            self.sock.settimeout(2)
            return self.sock.recv(1) == b""
        except (ConnectionResetError, BrokenPipeError):
            return True
        except socket.timeout:
            return False

    def close(self):
        self.sock.close()


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.bridge = Bridge()

    def tearDown(self):
        self.bridge.close()

    def test_state_is_reported(self):
        c = Client(self.bridge.port)
        self.assertIn("101", c.status)
        c.send({"type": "state", "uri": TRACK, "liked": False})
        self.assertEqual(self.bridge.read(), {"type": "state", "connected": True, "uri": TRACK, "liked": False})
        c.send({"type": "state", "uri": TRACK, "liked": True})
        self.assertEqual(self.bridge.read()["liked"], True)
        c.close()
        self.assertEqual(self.bridge.read(), {"type": "state", "connected": False, "uri": "", "liked": None})

    def test_unchanged_heartbeat_is_not_repeated(self):
        c = Client(self.bridge.port)
        c.send({"type": "state", "uri": TRACK, "liked": False})
        self.bridge.read()
        c.send({"type": "state", "uri": TRACK, "liked": False})
        self.assertIsNone(self.bridge.read(timeout=0.5))
        c.close()

    def test_command_reaches_client(self):
        c = Client(self.bridge.port)
        c.send({"type": "state", "uri": TRACK, "liked": False})
        self.bridge.read()
        self.bridge.command(f"set {TRACK} 1")
        opcode, data = c.recv()
        self.assertEqual(opcode, 0x1)
        self.assertEqual(json.loads(data), {"type": "set", "uri": TRACK, "liked": True})
        c.close()

    def test_bad_commands_are_refused(self):
        for line in ["set spotify:track:short 1", f"set {TRACK} 2", "rm -rf /", f"set {TRACK} 1 extra"]:
            self.bridge.command(line)
            self.assertEqual(self.bridge.read()["type"], "error", line)

    def test_command_without_client_is_an_error(self):
        self.bridge.command(f"set {TRACK} 1")
        self.assertEqual(self.bridge.read()["message"], "Spotify extension not connected")

    def test_foreign_origin_is_rejected(self):
        for origin in ["https://evil.example", "null", "", "https://xpui.app.spotify.com.evil.example"]:
            c = Client(self.bridge.port, origin=origin)
            self.assertIn("403", c.status, origin)
            c.close()
        self.assertIsNone(self.bridge.read(timeout=0.5))

    def test_foreign_host_is_rejected(self):
        c = Client(self.bridge.port, host="evil.example")
        self.assertIn("403", c.status)
        c.close()

    def test_invalid_messages_drop_the_client(self):
        bad = [
            {"type": "state", "uri": "spotify:episode:4uLU6hMCjMI75M1A2tKUQC", "liked": True},
            {"type": "state", "uri": TRACK, "liked": "yes"},
            {"type": "hello"},
            ["not", "an", "object"],
        ]
        for msg in bad:
            c = Client(self.bridge.port)
            c.send(msg)
            self.assertTrue(c.is_closed(), msg)
            c.close()
        self.assertIsNone(self.bridge.read(timeout=0.5))

    def test_unmasked_and_oversized_frames_drop_the_client(self):
        c = Client(self.bridge.port)
        c.send_raw(0x1, b'{"type":"state","uri":"","liked":null}', masked=False)
        self.assertTrue(c.is_closed())
        c.close()
        c = Client(self.bridge.port)
        c.send_raw(0x1, b"x" * 5000)
        self.assertTrue(c.is_closed())
        c.close()

    def test_newest_client_wins(self):
        a = Client(self.bridge.port)
        a.send({"type": "state", "uri": TRACK, "liked": False})
        self.bridge.read()
        b = Client(self.bridge.port)
        b.send({"type": "state", "uri": OTHER, "liked": True})
        self.assertEqual(self.bridge.read()["uri"], OTHER)
        self.assertTrue(a.is_closed())
        a.close()
        b.close()

    def test_exits_when_stdin_closes(self):
        self.bridge.proc.stdin.close()
        self.assertEqual(self.bridge.proc.wait(timeout=3), 0)


if __name__ == "__main__":
    unittest.main()
