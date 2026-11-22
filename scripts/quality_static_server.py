#!/usr/bin/env python3
"""Statischer Testserver fuer das Lighthouse-/WCAG-Audit in der CI.

Warum (22.11.2026): ``python -m http.server`` liefert alles unkomprimiert aus.
Der Live-Shop kommt ueber Cloudflare mit Brotli/Gzip (app.css: 114 KB roh,
~27 KB gzip). Lighthouse simuliert ein langsames Mobilnetz, deshalb kostete
das rohe, renderblockierende app.css in der CI rund 0,6 s und die mobile LCP
der Startseite schwankte um die 2,5-s-Grenze (rote ``chromium-smoke``-Laeufe
mit 2552 ms oder Performance 93). Dieser Server komprimiert Textdateien wie
die Produktion, damit das Audit misst, was Kunden wirklich bekommen.
Die Grenzwerte in validate_quality_regression_floors.py bleiben unveraendert.

Aufruf: python scripts/quality_static_server.py <port>   (bindet 127.0.0.1)
"""
from __future__ import annotations

import gzip
import io
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

KOMPRIMIERBAR = (
    "text/", "application/javascript", "application/json", "application/manifest+json",
    "application/xml", "image/svg+xml", "application/x-javascript", "text/javascript",
)
MIN_BYTES = 1024


class GzipHandler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):  # ruhig, Log liegt ohnehin in /tmp
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def send_head(self):
        will_gzip = "gzip" in (self.headers.get("Accept-Encoding") or "").lower()
        path = self.translate_path(self.path)
        if not will_gzip or os.path.isdir(path) and not self.path.endswith("/"):
            return super().send_head()
        if os.path.isdir(path):
            for index in ("index.html", "index.htm"):
                kandidat = os.path.join(path, index)
                if os.path.isfile(kandidat):
                    path = kandidat
                    break
        if not os.path.isfile(path):
            return super().send_head()
        ctype = self.guess_type(path)
        if not ctype.startswith(KOMPRIMIERBAR) or os.path.getsize(path) < MIN_BYTES:
            return super().send_head()
        with open(path, "rb") as fh:
            roh = fh.read()
        daten = gzip.compress(roh, compresslevel=6, mtime=0)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Encoding", "gzip")
        self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(daten)))
        self.end_headers()
        return io.BytesIO(daten)


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4174
    handler = partial(GzipHandler, directory=os.getcwd())
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
