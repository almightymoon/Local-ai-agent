"""Small public-page fetcher. Pin validated DNS addresses, including on redirects."""

import http.client
import ipaddress
import re
import socket
import ssl
from html import unescape
from urllib.parse import urljoin, urlsplit


def fetch_webpage_title(url: str):
    if "://" not in url:
        url = "https://" + url
    for _ in range(4):
        parsed = urlsplit(url)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
        ):
            raise ValueError("Use a public HTTP or HTTPS URL without credentials.")
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if port not in {80, 443}:
            raise ValueError("Only public web ports 80 and 443 are supported.")
        addresses = socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)
        if not addresses or any(
            not ipaddress.ip_address(item[4][0]).is_global for item in addresses
        ):
            raise ValueError(
                "Local, private, and reserved network addresses are blocked."
            )
        # Connect to the already checked IP; never resolve the hostname a second time.
        sock = socket.create_connection((addresses[0][4][0], port), timeout=15)
        conn = http.client.HTTPConnection(parsed.hostname, port, timeout=15)
        try:
            if parsed.scheme == "https":
                sock = ssl.create_default_context().wrap_socket(
                    sock, server_hostname=parsed.hostname
                )
            conn.sock = sock
            target = parsed.path or "/"
            if parsed.query:
                target += "?" + parsed.query
            conn.request(
                "GET",
                target,
                headers={
                    "User-Agent": "LocalAgent/0.2",
                    "Accept": "text/html,text/plain",
                },
            )
            response = conn.getresponse()
            if response.status in {301, 302, 303, 307, 308}:
                location = response.getheader("Location")
                if not location:
                    raise ValueError("Redirect has no destination.")
                url = urljoin(url, location)
                continue
            if response.status >= 400:
                raise ValueError(f"Page returned HTTP {response.status}.")
            if not any(
                kind in response.getheader("Content-Type", "")
                for kind in ("text/html", "text/plain")
            ):
                raise ValueError("Only text and HTML pages are supported.")
            body = response.read(1_000_001)
            if len(body) > 1_000_000:
                raise ValueError("Page exceeds the 1 MB limit.")
            html = body.decode("utf-8", errors="replace")
            title = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
            clean = re.sub(
                r"<(script|style)\b[^>]*>.*?</\1>", "", html, flags=re.I | re.S
            )
            return {
                "url": url,
                "title": unescape(title.group(1).strip()) if title else "Untitled page",
                "snippet": unescape(
                    re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", clean))
                ).strip()[:12000],
            }
        finally:
            conn.close()
            sock.close()
    raise ValueError("Too many redirects.")
