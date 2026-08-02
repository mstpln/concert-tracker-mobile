#!/usr/bin/env python3
"""Apply explicitly reviewed metadata overrides to newly generated artist records.

This post-processing step is review-only. It never writes to production and it
never modifies records that existed in the production baseline.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

import requests


def spotify_token() -> str | None:
    client_id = os.getenv("SPOTIFY_CLIENT_ID")
    client_secret = os.getenv("SPOTIFY_CLIENT_SECRET")
    if not client_id or not client_secret:
        return None
    response = requests.post(
        "https://accounts.spotify.com/api/token",
        data={"grant_type": "client_credentials"},
        auth=(client_id, client_secret),
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["access_token"]


def spotify_get(path: str, token: str) -> dict[str, Any]:
    response = requests.get(
        f"https://api.spotify.com/v1/{path}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def resolve_spotify(override: dict[str, Any], token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    spotify_id = override.get("spotifyId")
    if spotify_id:
        return spotify_get(f"artists/{spotify_id}", token)
    track_id = override.get("spotifyTrackId")
    if track_id:
        track = spotify_get(f"tracks/{track_id}", token)
        artists = track.get("artists") or []
        if len(artists) != 1 or not artists[0].get("id"):
            raise RuntimeError("reviewed Spotify track did not resolve to one artist")
        return spotify_get(f"artists/{artists[0]['id']}", token)
    return None


def attach_spotify(band: dict[str, Any], artist: dict[str, Any]) -> list[str]:
    changed: list[str] = []
    spotify_id = artist.get("id")
    spotify_url = (artist.get("external_urls") or {}).get("spotify")
    if not spotify_id or not spotify_url:
        raise RuntimeError("Spotify artist response missing id/url")

    socials = band.setdefault("socials", {})
    if socials.get("spotify") != spotify_url:
        socials["spotify"] = spotify_url
        changed.append("socials.spotify")

    mb = band.setdefault("musicbrainz", {})
    metadata = mb.setdefault("metadata", {})
    reviewed_at = band.get("enrichedAt") or band.get("addedAt")
    reviewed = {
        "id": spotify_id,
        "url": spotify_url,
        "artistName": artist.get("name"),
        "status": "confirmed",
        "matchMethod": "manual_reviewed_override",
        "confidence": 100,
        "matchedAt": reviewed_at,
        "lastAttemptedAt": reviewed_at,
        "lastSuccessfulAt": reviewed_at,
        "nextEligibleCheckAt": None,
        "errorCategory": None,
    }
    if mb.get("spotify") != reviewed:
        mb["spotify"] = reviewed
        changed.append("musicbrainz.spotify")
    metadata_spotify = {"id": spotify_id, "url": spotify_url}
    if metadata.get("spotify") != metadata_spotify:
        metadata["spotify"] = metadata_spotify
        changed.append("musicbrainz.metadata.spotify")

    images = artist.get("images") or []
    if images and images[0].get("url") and not band.get("photoUrl"):
        band["photoUrl"] = images[0]["url"]
        changed.append("photoUrl")
    if not band.get("genre") and artist.get("genres"):
        band["genre"] = ", ".join(artist["genres"][:4])
        changed.append("genre")
    return changed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bands", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--overrides", required=True, type=Path)
    args = parser.parse_args()

    bands = json.loads(args.bands.read_text(encoding="utf-8"))
    report = json.loads(args.report.read_text(encoding="utf-8"))
    overrides = json.loads(args.overrides.read_text(encoding="utf-8"))
    input_count = int(report.get("inputCount", 0))
    new_bands = {band.get("name"): band for band in bands[input_count:]}
    token = spotify_token()
    audit: list[dict[str, Any]] = []

    for name, override in overrides.items():
        band = new_bands.get(name)
        if band is None:
            audit.append({"name": name, "status": "skipped", "reason": "new_record_not_found"})
            continue
        changed: list[str] = []
        try:
            spotify = resolve_spotify(override, token)
            if spotify:
                changed.extend(attach_spotify(band, spotify))
            for field in ("officialUrl", "genre", "formedYear", "bio"):
                value = override.get(field)
                if value and not band.get(field):
                    band[field] = value
                    changed.append(field)
            audit.append({
                "name": name,
                "status": "updated" if changed else "no_change",
                "changed": changed,
                "sources": override.get("sources") or [],
            })
        except Exception as exc:  # noqa: BLE001
            audit.append({"name": name, "status": "error", "error": str(exc)})

    remaining = {
        "missingOfficialUrl": sum(1 for band in bands[input_count:] if not band.get("officialUrl")),
        "missingPhotoUrl": sum(1 for band in bands[input_count:] if not band.get("photoUrl")),
        "missingGenre": sum(1 for band in bands[input_count:] if not band.get("genre")),
        "missingOrigin": sum(1 for band in bands[input_count:] if not band.get("origin")),
        "missingFormedYear": sum(1 for band in bands[input_count:] if not band.get("formedYear")),
        "missingBio": sum(1 for band in bands[input_count:] if not band.get("bio")),
        "missingSpotify": sum(1 for band in bands[input_count:] if not ((band.get("musicbrainz") or {}).get("spotify"))),
        "missingTicketmaster": sum(1 for band in bands[input_count:] if not ((band.get("musicbrainz") or {}).get("ticketmaster"))),
    }
    report["reviewedOverrideAudit"] = audit
    report["remainingMissing"] = remaining
    args.bands.write_text(json.dumps(bands, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "updated": sum(1 for item in audit if item.get("status") == "updated"),
        "errors": sum(1 for item in audit if item.get("status") == "error"),
        **remaining,
    }, indent=2))
    return 1 if any(item.get("status") == "error" for item in audit) else 0


if __name__ == "__main__":
    raise SystemExit(main())
