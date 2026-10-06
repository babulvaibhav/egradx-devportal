"""Downloads the EGRADX SDK's Python wheels from the GitHub release python-v1.0.0 into egradx-wheels/, where
pyproject.toml installs them from. Needs GITHUB_TOKEN, a token that can read the SDK's repository."""

import json
import os
import sys
import urllib.request
from pathlib import Path

REPOSITORY = "babulvaibhav/egradx-v1-workspace"
RELEASE = "python-v1.0.0"


def get(url: str, accept: str) -> bytes:
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {os.environ['GITHUB_TOKEN']}", "Accept": accept})
    with urllib.request.urlopen(request) as response:
        return response.read()


def main() -> None:
    if not os.environ.get("GITHUB_TOKEN"):
        sys.exit("Set GITHUB_TOKEN to a token that can read the SDK's repository (README.md)")
    target = Path(__file__).resolve().parent.parent / "egradx-wheels"
    target.mkdir(exist_ok=True)
    release = json.loads(get(f"https://api.github.com/repos/{REPOSITORY}/releases/tags/{RELEASE}", "application/vnd.github+json"))
    for asset in release["assets"]:
        if asset["name"].endswith(".whl"):
            (target / asset["name"]).write_bytes(get(asset["url"], "application/octet-stream"))
            print(f"downloaded {asset['name']}")


if __name__ == "__main__":
    main()
