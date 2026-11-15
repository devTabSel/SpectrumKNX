#!/usr/bin/env python3
"""devTabSel HAOS packaging overlay — fork/main only.

Applies / asserts Home Assistant add-on branding so the devTabSel fork is
recognizable in HAOS (sidebar title, store name, GHCR image, repository URL).

This file and the devTabSel packaging deltas it manages must never be part of
a pull request into martinhoefling/SpectrumKNX. Keep them on devTabSel's
`main` (or devTabSel-only branches). Feature branches destined for Origin must
retain martinhoefling packaging unchanged.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OWNER = "dev" + "TabSel"
OWNER_LC = OWNER.lower()
REPO_URL = f"https://github.com/{OWNER}/SpectrumKNX"
IMAGE = f"ghcr.io/{OWNER_LC}/spectrum-knx-addon-{{arch}}"

BETA_FILES = (
    ROOT / "ha-addon-beta" / "config.yaml",
    ROOT / "ha-addon-companion-beta" / "config.yaml",
)
REPO_YAML = ROOT / "repository.yaml"

VERSION_RE = re.compile(
    rf'^version:\s*"(?P<ver>2\.0\.0-beta\.\d+-{re.escape(OWNER)}\.\d+)"\s*$',
    re.M,
)


def _replace_line(text: str, key: str, value: str) -> str:
    pattern = re.compile(rf"^{re.escape(key)}:.*$", re.M)
    repl = f'{key}: "{value}"'
    new, n = pattern.subn(repl, text, count=1)
    if n != 1:
        raise SystemExit(f"could not set {key} in packaging file")
    return new


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def apply_branding() -> None:
    beta = _read(BETA_FILES[0])
    companion = _read(BETA_FILES[1])
    em = "\u2014"
    dot = "\u00b7"

    beta = _replace_line(beta, "name", f"Spectrum KNX (Beta, {OWNER})")
    beta = _replace_line(
        beta,
        "description",
        f"BETA ({OWNER}) {em} A professional KNX bus monitor and analyzer",
    )
    beta = _replace_line(beta, "url", REPO_URL)
    beta = _replace_line(beta, "image", IMAGE)
    beta = _replace_line(beta, "panel_title", f"Spectrum KNX Beta {dot} {OWNER}")

    companion = _replace_line(
        companion,
        "name",
        f"Spectrum KNX (HA Companion, Beta, {OWNER})",
    )
    companion = _replace_line(
        companion,
        "description",
        (
            f"BETA ({OWNER}) {em} KNX analyzer UI on top of Home Assistant's own "
            f"KNX telegram history {em} no second bus connection, no separate database"
        ),
    )
    companion = _replace_line(companion, "url", REPO_URL)
    companion = _replace_line(companion, "image", IMAGE)
    companion = _replace_line(
        companion,
        "panel_title",
        f"Spectrum KNX (HA) Beta {dot} {OWNER}",
    )

    # Keep existing devTabSel under-counter versions; only rewrite identity fields.
    _write(BETA_FILES[0], beta)
    _write(BETA_FILES[1], companion)
    _write(
        REPO_YAML,
        f'name: "Spectrum KNX Add-ons"\nurl: "{REPO_URL}"\nmaintainer: "{OWNER}"\n',
    )
    print(f"applied {OWNER} HAOS branding overlay")


def assert_branding() -> None:
    errors: list[str] = []
    for path in BETA_FILES:
        text = _read(path)
        if f'url: "{REPO_URL}"' not in text:
            errors.append(f"{path}: url must be {REPO_URL}")
        if f'image: "{IMAGE}"' not in text:
            errors.append(f"{path}: image must be {IMAGE}")
        if OWNER not in text:
            errors.append(f"{path}: missing {OWNER} identity in name/panel_title")
        if "martinhoefling/spectrum-knx-addon" in text:
            errors.append(f"{path}: still points at martinhoefling GHCR image")
        if not VERSION_RE.search(text):
            errors.append(
                f"{path}: version must match 2.0.0-beta.N-{OWNER}.M under-counter"
            )
    repo = _read(REPO_YAML)
    if REPO_URL not in repo or OWNER not in repo:
        errors.append(f"{REPO_YAML}: must point at {OWNER}")
    if errors:
        print("devTabSel HAOS branding check failed:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        raise SystemExit(1)
    print(f"{OWNER} HAOS branding OK")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("assert", "apply"),
        help="assert = CI check; apply = rewrite identity fields on devTabSel main",
    )
    args = parser.parse_args()
    if args.command == "apply":
        apply_branding()
        assert_branding()
    else:
        assert_branding()


if __name__ == "__main__":
    main()
