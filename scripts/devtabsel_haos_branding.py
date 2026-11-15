#!/usr/bin/env python3
"""devTabSel HAOS packaging overlay — fork/main only.

Applies / asserts / bumps Home Assistant add-on branding so the devTabSel fork
is recognizable in HAOS (sidebar title, store name, GHCR image, repository URL).

This file and the devTabSel packaging deltas it manages must never be part of
a pull request into martinhoefling/SpectrumKNX. Keep them on devTabSel's
`main` (or devTabSel-only publish commits). Feature branches destined for Origin
must retain martinhoefling packaging unchanged.
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
CHANGELOG_FILES = (
    ROOT / "ha-addon-beta" / "CHANGELOG.md",
    ROOT / "ha-addon-companion-beta" / "CHANGELOG.md",
)
REPO_YAML = ROOT / "repository.yaml"

PLAIN_VERSION_RE = re.compile(
    r'^version:\s*"(?P<base>2\.0\.0-beta\.(?P<n>\d+))"\s*$',
    re.M,
)
FORK_VERSION_RE = re.compile(
    rf'^version:\s*"(?P<base>2\.0\.0-beta\.(?P<n>\d+))-{re.escape(OWNER)}\.(?P<c>\d+)"\s*$',
    re.M,
)
ANY_VERSION_RE = re.compile(
    rf'^version:\s*"(?P<full>2\.0\.0-beta\.(?P<n>\d+)(?:-{re.escape(OWNER)}\.(?P<c>\d+))?)"\s*$',
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


def _parse_version(text: str) -> tuple[str, int | None]:
    """Return (base like 2.0.0-beta.14, counter or None if plain origin version)."""
    m = FORK_VERSION_RE.search(text)
    if m:
        return m.group("base"), int(m.group("c"))
    m = PLAIN_VERSION_RE.search(text)
    if m:
        return m.group("base"), None
    raise SystemExit(f"unrecognized version line in packaging file")


def _parse_version_string(value: str) -> tuple[str, int | None]:
    m = re.fullmatch(
        rf"(?P<base>2\.0\.0-beta\.(?P<n>\d+))(?:-{re.escape(OWNER)}\.(?P<c>\d+))?",
        value.strip(),
    )
    if not m:
        raise SystemExit(f"unrecognized version string: {value!r}")
    counter = int(m.group("c")) if m.group("c") else None
    return m.group("base"), counter


def apply_branding(*, version: str | None = None) -> None:
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

    if version is not None:
        beta = _replace_line(beta, "version", version)
        companion = _replace_line(companion, "version", version)

    _write(BETA_FILES[0], beta)
    _write(BETA_FILES[1], companion)
    _write(
        REPO_YAML,
        f'name: "Spectrum KNX Add-ons"\nurl: "{REPO_URL}"\nmaintainer: "{OWNER}"\n',
    )
    print(f"applied {OWNER} HAOS branding overlay" + (f" @ {version}" if version else ""))


def _prepend_changelog(version: str, feature_ref: str | None) -> None:
    source = feature_ref or "feature branch"
    entry = (
        f"## {version}\n\n"
        f"### Changed\n\n"
        f"- **Test in HAOS**: published {OWNER} fork build from `{source}` with "
        f"sidebar/store branding.\n\n"
    )
    for path in CHANGELOG_FILES:
        text = _read(path)
        needle = "# Changelog\n\n"
        if not text.startswith(needle):
            raise SystemExit(f"unexpected changelog header in {path}")
        if f"## {version}\n" in text:
            continue
        _write(path, text.replace(needle, needle + entry, 1))


def bump(*, previous: str | None = None, feature_ref: str | None = None) -> str:
    """Brand configs and bump the devTabSel under-counter.

    `previous` should be the devTabSel main version *before* merging the feature
    branch, so the under-counter keeps climbing under the same origin beta base.
    """
    current_base, _ = _parse_version(_read(BETA_FILES[0]))
    if previous:
        prev_base, prev_counter = _parse_version_string(previous)
    else:
        prev_base, prev_counter = current_base, None

    if prev_base == current_base and prev_counter is not None:
        next_counter = prev_counter + 1
    else:
        # New origin beta base, or first devTabSel publish under this base.
        next_counter = 1

    version = f"{current_base}-{OWNER}.{next_counter}"
    apply_branding(version=version)
    _prepend_changelog(version, feature_ref)
    assert_branding()
    print(f"bumped HAOS beta to {version}")
    return version


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
        if not FORK_VERSION_RE.search(text):
            errors.append(
                f"{path}: version must match 2.0.0-beta.N-{OWNER}.M under-counter"
            )
    repo = _read(REPO_YAML)
    if REPO_URL not in repo or OWNER not in repo:
        errors.append(f"{REPO_YAML}: must point at {OWNER}")
    if errors:
        print(f"{OWNER} HAOS branding check failed:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        raise SystemExit(1)
    print(f"{OWNER} HAOS branding OK")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("assert", "apply", "bump"),
        help="assert / apply identity / bump under-counter + brand",
    )
    parser.add_argument(
        "--previous",
        help=f"previous {OWNER} main version before merge (for under-counter)",
    )
    parser.add_argument(
        "--feature-ref",
        help="feature branch name recorded in the changelog",
    )
    args = parser.parse_args()
    if args.command == "apply":
        apply_branding()
        assert_branding()
    elif args.command == "bump":
        bump(previous=args.previous, feature_ref=args.feature_ref)
    else:
        assert_branding()


if __name__ == "__main__":
    main()
