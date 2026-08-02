#!/usr/bin/env python3
"""Fill missing Spotify-backed metadata on newly added artist records only.

This is a review-artifact post-processing step. It never writes to production,
never creates concerts, and never changes pre-existing records.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import unicodedata
from pathlib import Path
from typing import Any

import requests


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.casefold().replace("&", " and ")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value).split())


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


def spotify_search_exact(name: str, token: str) -> tuple[dict[str, Any] | None, str]:
    response = requests.get(
        "https://api.spotify.com/v1/search",
        params={"q": f'artist:"{name}"', "type": "artist", "limit": 10},
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    response.raise_for_status()
    items = ((response.json().get("artists") or {}).get("items") or [])
    exact = [item for item in items if normalize(item.get("name", "")) == normalize(name)]
    if len(exact) == 1:
        return exact[0], "unique_exact_name"
    if not exact:
        return None, "no_exact_name"
    return None, "multiple_exact_names"


def attach_spotify(band: dict[str, Any], spotify: dict[str, Any]) -> list[str]:
    changed: list[str] = []
    spotify_id = spotify.get("id")
    spotify_url = (spotify.get("external_urls") or {}).get("spotify")
    spotify_name = spotify.get("name")
    if not spotify_id or not spotify_url:
        return changed

    socials = band.setdefault("socials", {})
    if not socials.get("spotify"):
        socials["spotify"] = spotify_url
        changed.append("socials.spotify")

    musicbrainz = band.setdefault("musicbrainz", {})
    metadata = musicbrainz.setdefault("metadata", {})
    if not metadata.get("spotify"):
        metadata["spotify"] = {"id": spotify_id, "url": spotify_url}
        changed.append("musicbrainz.metadata.spotify")

    if not musicbrainz.get("spotify"):
        musicbrainz["spotify"] = {
            "id": spotify_id,
            "url": spotify_url,
            "artistName": spotify_name,
            "status": "confirmed",
            "matchMethod": "spotify_unique_exact_name_fallback",
            "confidence": 95,
            "matchedAt": band.get("enrichedAt") or band.get("addedAt"),
            "lastAttemptedAt": band.get("enrichedAt") or band.get("addedAt"),
            "lastSuccessfulAt": band.get("enrichedAt") or band.get("addedAt"),
            "nextEligibleCheckAt": None,
            "errorCategory": None,
        }
        changed.append("musicbrainz.spotify")

    images = spotify.get("images") or []
    if not band.get("photoUrl") and images and images[0].get("url"):
        band["photoUrl"] = images[0]["url"]
        changed.append("photoUrl")

    genres = spotify.get("genres") or []
    if not band.get("genre") and genres:
        band["genre"] = ", ".join(genres[:4])
        changed.append("genre")

    return changed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bands", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()

    bands = json.loads(args.bands.read_text(encoding="utf-8"))
    report = json.loads(args.report.read_text(encoding="utf-8"))
    input_count = int(report.get("inputCount", 0))
    token = spotify_token()
    audit: list[dict[str, Any]] = []

    if token:
        for band in bands[input_count:]:
            needs_spotify = not ((band.get("musicbrainz") or {}).get("spotify"))
            needs_photo = not band.get("photoUrl")
            needs_genre = not band.get("genre")
            if not (needs_spotify or needs_photo or needs_genre):
                continue
            try:
                match, reason = spotify_search_exact(band.get("name", ""), token)
                if not match:
                    audit.append({"name": band.get("name"), "status": "not_updated", "reason": reason})
                    continue
                changed = attach_spotify(band, match)
                audit.append({
                    "name": band.get("name"),
                    "status": "updated" if changed else "no_change",
                    "spotifyId": match.get("id"),
                    "spotifyName": match.get("name"),
                    "changed": changed,
                })
            except Exception as exc:  # noqa: BLE001
                audit.append({"name": band.get("name"), "status": "error", "error": str(exc)})
    else:
        audit.append({"status": "skipped", "reason": "spotify_credentials_missing"})

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
    report["spotifyFallbackAudit"] = audit
    report["remainingMissing"] = remaining
    args.bands.write_text(json.dumps(bands, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"updated": sum(1 for item in audit if item.get("status") == "updated"), **remaining}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
