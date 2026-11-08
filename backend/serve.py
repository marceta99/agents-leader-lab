"""Production entrypoint: serve on PORT over both IPv4 and IPv6.

uvicorn's --host binds one family only ("::" is IPv6-only, "0.0.0.0" IPv4-only), and Railway's private
network can reach the backend over either, so bind one socket per family and hand both to uvicorn.
"""

import os
import socket

import uvicorn

port = int(os.environ.get("PORT", "8000"))
sockets = []
for family, host in ((socket.AF_INET, "0.0.0.0"), (socket.AF_INET6, "::")):
    s = socket.socket(family, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    if family == socket.AF_INET6:
        s.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
    s.bind((host, port))
    sockets.append(s)

config = uvicorn.Config("app.main:app", proxy_headers=True, forwarded_allow_ips="*")
uvicorn.Server(config).run(sockets=sockets)
