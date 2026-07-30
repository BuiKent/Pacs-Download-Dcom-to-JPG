"""Run the production local API/frontend in a normal browser for UI tests."""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from web_backend import LocalApiServer, WebController


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", default="")
    parser.add_argument("--static", default="web_dist")
    args = parser.parse_args()
    controller = WebController()
    if args.archive:
        controller.open_archive(args.archive)
    server = LocalApiServer(controller, Path(args.static))
    try:
        print(server.start(), flush=True)
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        server.stop()
