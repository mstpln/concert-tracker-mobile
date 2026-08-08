#!/usr/bin/env python3
"""Fill missing reviewed metadata on newly added artist records only.

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


def spotify_get(path: str, token: str) -> dict[str, Any]:
    response = requests.get(
        f"https://api.spotify.com/v1/{path}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


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


def spotify_from_override(override: dict[str, Any], token: str) -> dict[str, Any] | None:
    spotify_id = override.get("spotifyId")
    if spotify_id:
        return spotify_get(f"artists/{spotify_id}", token)
    track_id = override.get("spotifyTrackId")
    if track_id:
        track = spotify_get(f"tracks/{track_id}", token)
        artists = track.get("artists") or []
        if len(artists) == 1 and artists[0].get("id"):
            return spotify_get(f"artists/{artists[0]['id']}", token)
    return None


def attach_spotify(band: dict[str, Any], spotify: dict[str, Any], method: str, confidence: int) -> list[str]:
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
        timestamp = band.get("enrichedAt") or band.get("addedAt")
        musicbrainz["spotify"] = {
            "id": spotify_id,
            "url": spotify_url,
            "artistName": spotify_name,
            "status": "confirmed",
            "matchMethod": method,
            "confidence": confidence,
            "matchedAt": timestamp,
            "lastAttemptedAt": timestamp,
            "lastSuccessfulAt": timestamp,
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


def apply_reviewed_fields(band: dict[str, Any], override: dict[str, Any]) -> list[str]:
    changed: list[str] = []
    for field in ("officialUrl", "genre", "formedYear", "bio"):
        value = override.get(field)
        if value and not band.get(field):
            band[field] = value
            changed.append(field)
    if override.get("sources"):
        band.setdefault("reviewedMetadata", {})["sources"] = override["sources"]
        band["reviewedMetadata"]["status"] = "manually_reviewed"
        changed.append("reviewedMetadata")
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
    token = spotify_token()
    audit: list[dict[str, Any]] = []

    for band in bands[input_count:]:
        name = band.get("name", "")
        override = overrides.get(name) or {}
        changed = apply_reviewed_fields(band, override)
        spotify = None
        method = None
        confidence = None
        try:
            if token and (override.get("spotifyId") or override.get("spotifyTrackId")):
                spotify = spotify_from_override(override, token)
                method = "reviewed_spotify_override"
                confidence = 100
            elif token:
                needs_spotify = not ((band.get("musicbrainz") or {}).get("spotify"))
                needs_photo = not band.get("photoUrl")
                needs_genre = not band.get("genre")
                if needs_spotify or needs_photo or needs_genre:
                    spotify, reason = spotify_search_exact(name, token)
                    if spotify:
                        method = "spotify_unique_exact_name_fallback"
                        confidence = 95
                    elif not changed:
                        audit.append({"name": name, "status": "not_updated", "reason": reason})
                        continue
            if spotify:
                changed.extend(attach_spotify(band, spotify, method or "spotify_fallback", confidence or 95))
            if changed:
                audit.append({
                    "name": name,
                    "status": "updated",
                    "spotifyId": spotify.get("id") if spotify else None,
                    "spotifyName": spotify.get("name") if spotify else None,
                    "changed": sorted(set(changed)),
                })
        except Exception as exc:  # noqa: BLE001
            audit.append({"name": name, "status": "error", "error": str(exc), "changedBeforeError": changed})

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
    report["reviewedMetadataAudit"] = audit
    report["remainingMissing"] = remaining
    args.bands.write_text(json.dumps(bands, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"updated": sum(1 for item in audit if item.get("status") == "updated"), **remaining}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
