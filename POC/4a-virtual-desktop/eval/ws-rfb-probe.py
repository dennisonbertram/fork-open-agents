#!/usr/bin/env python3
"""Connect to the noVNC WebSocket endpoint and prove the RFB bridge is live.

This performs a real RFC6455 WebSocket handshake against websockify, then reads
the first VNC frame. websockify proxies the raw RFB byte stream, so the very
first bytes the VNC server (x11vnc) sends are the ProtocolVersion banner:
"RFB 003.00x\n" (12 bytes). Reading that banner end-to-end proves:
  browser WebSocket  ->  websockify  ->  x11vnc  ->  Xvfb
is fully wired. Pure stdlib (socket + base64 + hashlib); no pip deps.
"""
import base64
import hashlib
import os
import socket
import struct
import sys

HOST = os.environ.get("NOVNC_HOST", "127.0.0.1")
PORT = int(os.environ.get("NOVNC_PORT", "6080"))
PATH = os.environ.get("NOVNC_PATH", "/websockify")
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"  # RFC6455 magic


def ws_handshake(sock: socket.socket) -> None:
    key = base64.b64encode(os.urandom(16)).decode()
    req = (
        f"GET {PATH} HTTP/1.1\r\n"
        f"Host: {HOST}:{PORT}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "Sec-WebSocket-Protocol: binary\r\n"
        "\r\n"
    )
    sock.sendall(req.encode())
    resp = b""
    while b"\r\n\r\n" not in resp:
        chunk = sock.recv(1024)
        if not chunk:
            raise RuntimeError("server closed during handshake")
        resp += chunk
    head = resp.split(b"\r\n\r\n", 1)[0].decode(errors="replace")
    if "101" not in head.split("\r\n")[0]:
        raise RuntimeError(f"expected HTTP 101, got:\n{head}")
    expected = base64.b64encode(
        hashlib.sha1((key + GUID).encode()).digest()
    ).decode()
    accept = ""
    for line in head.split("\r\n"):
        if line.lower().startswith("sec-websocket-accept:"):
            accept = line.split(":", 1)[1].strip()
    if accept != expected:
        raise RuntimeError(f"bad Sec-WebSocket-Accept: {accept!r} != {expected!r}")
    print(f"[ws] handshake OK (101 Switching Protocols), accept verified")


def ws_read_frame(sock: socket.socket) -> bytes:
    """Read a single (unmasked, server->client) WebSocket data frame payload."""
    hdr = recv_exact(sock, 2)
    b0, b1 = hdr[0], hdr[1]
    fin = b0 & 0x80
    opcode = b0 & 0x0F
    masked = b1 & 0x80
    length = b1 & 0x7F
    if length == 126:
        length = struct.unpack(">H", recv_exact(sock, 2))[0]
    elif length == 127:
        length = struct.unpack(">Q", recv_exact(sock, 8))[0]
    mask = recv_exact(sock, 4) if masked else b""
    payload = recv_exact(sock, length) if length else b""
    if masked:
        payload = bytes(payload[i] ^ mask[i % 4] for i in range(len(payload)))
    _ = (fin, opcode)
    return payload


def recv_exact(sock: socket.socket, n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise RuntimeError("server closed mid-frame")
        buf += chunk
    return buf


def main() -> int:
    print(f"[ws] connecting ws://{HOST}:{PORT}{PATH}")
    sock = socket.create_connection((HOST, PORT), timeout=10)
    sock.settimeout(10)
    ws_handshake(sock)
    # First WS data frame carries the RFB ProtocolVersion banner from x11vnc.
    banner = b""
    while len(banner) < 12:
        banner += ws_read_frame(sock)
    text = banner[:12].decode(errors="replace").strip()
    print(f"[rfb] ProtocolVersion banner: {text!r}")
    if not banner.startswith(b"RFB 003."):
        print("[rfb] FAIL: did not receive a valid RFB ProtocolVersion banner")
        return 1
    print("[rfb] PASS: live VNC bridge confirmed (browser WS -> websockify -> VNC server -> Xvfb)")
    sock.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
