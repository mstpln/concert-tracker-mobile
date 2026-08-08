#!/usr/bin/env python3
"""Bulk-enrich missing LiveVault artists from public provider metadata.

The script never writes to Cloudflare or production. It reads an exported
bands.json and produces a replacement candidate plus an audit report.

Public providers:
- MusicBrainz: identity, aliases, artist type, area/country, dates, URL relations
- Wikidata/Wikipedia: short neutral description when connected from MusicBrainz
- Spotify (optional credentials): canonical artist, genres, image
- Ticketmaster (optional API key): attraction identity only, no concerts

Environment variables (optional):
  SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, TICKETMASTER_API_KEY
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import json
import os
import re
import sys
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

import requests

MB_BASE = "https://musicbrainz.org/ws/2"
UA = "TheLiveVaultBulkEnricher/1.0 (personal single-user app)"
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": UA, "Accept": "application/json"})

EXPLICIT_MBIDS = {
    "Kanye West": "164f0d73-1234-4e2c-8743-d77bf2191051",
    "Teddybears": "677c6265-b0f7-4d5b-982e-ffe8b01e131f",
    "Snook": "625564a5-dece-4d8c-b93a-1a3e88f14d5c",
    "Venus": "34dbc4c3-fbf9-4dce-993e-55171a85a9fa",
    "Axwell /\\ Ingrosso": "00323ee1-05b6-4cf6-98c4-94f0701645d3",
}

OFFICIAL_REL_TYPES = {
    "official homepage": "officialUrl",
    "social network": "social",
    "streaming music": "streaming",
    "youtube": "youtube",
    "wikidata": "wikidata",
    "wikipedia": "wikipedia",
}
SOCIAL_HOSTS = {
    "instagram.com": "instagram",
    "facebook.com": "facebook",
    "x.com": "x",
    "twitter.com": "x",
    "tiktok.com": "tiktok",
    "youtube.com": "youtube",
    "youtu.be": "youtube",
}


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_name(value: str) -> str:
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.casefold().replace("&", " and ")
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return " ".join(value.split())


def slugify(value: str) -> str:
    s = normalize_name(value).replace(" and ", "-")
    s = re.sub(r"\s+", "-", s).strip("-")
    return s or "artist"


def host(url: str) -> str:
    h = urlparse(url).netloc.lower().split(":")[0]
    return h[4:] if h.startswith("www.") else h


@dataclass
class Candidate:
    artist: dict[str, Any]
    score: int
    exact_name: bool
    exact_alias: bool


def get_json(url: str, params: dict[str, Any] | None = None, *, mb: bool = False, retries: int = 4) -> dict[str, Any]:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            if mb:
                time.sleep(1.1)
            response = SESSION.get(url, params=params, timeout=40)
            if response.status_code in (429, 503):
                time.sleep(2 ** attempt + 1)
                continue
            response.raise_for_status()
            return response.json()
        except Exception as exc:  # noqa: BLE001
            last = exc
            if attempt + 1 < retries:
                time.sleep(2 ** attempt + 1)
    raise RuntimeError(f"GET failed: {url}: {last}")


def musicbrainz_search(name: str) -> list[Candidate]:
    safe = name.replace('"', "")
    data = get_json(
        f"{MB_BASE}/artist/",
        {"query": f'artist:"{safe}"', "fmt": "json", "limit": 10},
        mb=True,
    )
    target = normalize_name(name)
    candidates = []
    for artist in data.get("artists", []):
        aliases = [a.get("name", "") for a in artist.get("aliases", [])]
        candidates.append(Candidate(
            artist=artist,
            score=int(artist.get("score", 0)),
            exact_name=normalize_name(artist.get("name", "")) == target,
            exact_alias=any(normalize_name(alias) == target for alias in aliases),
        ))
    return sorted(candidates, key=lambda x: (x.exact_name, x.exact_alias, x.score), reverse=True)


def select_candidate(name: str, candidates: list[Candidate]) -> tuple[dict[str, Any] | None, str, int]:
    if not candidates:
        return None, "no_results", 0
    top = candidates[0]
    second_score = candidates[1].score if len(candidates) > 1 else -1
    if top.exact_name and top.score >= 95 and (top.score - second_score >= 5 or not candidates[1].exact_name):
        return top.artist, "exact_name", min(100, top.score)
    if top.exact_alias and top.score >= 95 and top.score - second_score >= 8:
        return top.artist, "exact_alias", min(99, top.score)
    return None, "ambiguous", top.score


def musicbrainz_lookup(mbid: str) -> dict[str, Any]:
    return get_json(
        f"{MB_BASE}/artist/{mbid}",
        {"inc": "aliases+genres+url-rels", "fmt": "json"},
        mb=True,
    )


def parse_relations(mb: dict[str, Any]) -> dict[str, Any]:
    result = {
        "officialUrl": None,
        "spotifyUrl": None,
        "wikidataUrl": None,
        "wikipediaUrl": None,
        "socials": {},
    }
    for relation in mb.get("relations", []):
        if relation.get("target-type") != "url":
            continue
        url = (relation.get("url") or {}).get("resource")
        if not url:
            continue
        relation_type = relation.get("type")
        relation_host = host(url)
        if relation_type == "official homepage" and not result["officialUrl"]:
            result["officialUrl"] = url
        if relation_host == "open.spotify.com" and "/artist/" in url:
            result["spotifyUrl"] = url
        if relation_host.endswith("wikidata.org"):
            result["wikidataUrl"] = url
        if relation_host.endswith("wikipedia.org"):
            result["wikipediaUrl"] = url
        for domain, key in SOCIAL_HOSTS.items():
            if relation_host == domain or relation_host.endswith("." + domain):
                result["socials"].setdefault(key, url)
    if result["spotifyUrl"]:
        result["socials"]["spotify"] = result["spotifyUrl"]
    return result


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


def spotify_get_artist(url: str | None, token: str | None) -> dict[str, Any] | None:
    if not url or not token:
        return None
    match = re.search(r"/artist/([A-Za-z0-9]+)", url)
    if not match:
        return None
    response = requests.get(
        f"https://api.spotify.com/v1/artists/{match.group(1)}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.json()


def ticketmaster_search(name: str) -> dict[str, Any] | None:
    key = os.getenv("TICKETMASTER_API_KEY")
    if not key:
        return None
    data = get_json(
        "https://app.ticketmaster.com/discovery/v2/attractions.json",
        {"apikey": key, "keyword": name, "classificationName": "music", "size": 10},
    )
    attractions = (((data or {}).get("_embedded") or {}).get("attractions") or [])
    exact = [item for item in attractions if normalize_name(item.get("name", "")) == normalize_name(name)]
    return exact[0] if len(exact) == 1 else None


def short_description(wikidata_url: str | None, wikipedia_url: str | None) -> str | None:
    if wikidata_url:
        match = re.search(r"/(Q\d+)(?:$|[?#])", wikidata_url)
        if match:
            qid = match.group(1)
            try:
                data = get_json(f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json")
                text = data.get("entities", {}).get(qid, {}).get("descriptions", {}).get("en", {}).get("value")
                if text:
                    return text[:1].upper() + text[1:].rstrip(".") + "."
            except Exception:  # noqa: BLE001
                pass
    if wikipedia_url:
        try:
            parsed = urlparse(wikipedia_url)
            title = parsed.path.split("/wiki/", 1)[1]
            data = get_json(f"https://{parsed.netloc}/api/rest_v1/page/summary/{quote(title)}")
            return (data.get("extract") or "").split("\n", 1)[0].strip() or None
        except Exception:  # noqa: BLE001
            pass
    return None


def make_origin(mb: dict[str, Any]) -> str | None:
    values = []
    for value in (
        (mb.get("begin-area") or {}).get("name"),
        (mb.get("area") or {}).get("name"),
        mb.get("country"),
    ):
        if value and value not in values:
            values.append(value)
    return ", ".join(values) or None


def begin_year(mb: dict[str, Any]) -> str | None:
    begin = ((mb.get("life-span") or {}).get("begin") or "")
    year = begin.split("-", 1)[0]
    return year if re.fullmatch(r"\d{4}", year) else None


def empty_research_state() -> dict[str, Any]:
    empty = {
        "status": "not_started",
        "knownKeys": [],
        "continuation": None,
        "lastAttemptedAt": None,
        "lastSuccessfulAt": None,
        "nextEligibleCheckAt": None,
        "errorCategory": None,
    }
    return {
        "releases": {
            "musicbrainz": copy.deepcopy(empty),
            "spotify": copy.deepcopy(empty),
            "knownAlerts": [],
            "observations": [],
            "canonical": [],
        },
        "routing": {"groqFingerprints": []},
    }


def build_record(
    display_name: str,
    mb: dict[str, Any],
    confidence: int,
    method: str,
    spotify: dict[str, Any] | None,
    ticketmaster: dict[str, Any] | None,
) -> dict[str, Any]:
    ts = now_iso()
    relation_data = parse_relations(mb)
    spotify_url = relation_data["spotifyUrl"]
    spotify_id = None
    spotify_name = mb.get("name")
    photo = None
    genres = [genre.get("name") for genre in mb.get("genres", []) if genre.get("name")]

    if spotify:
        spotify_id = spotify.get("id")
        spotify_name = spotify.get("name")
        spotify_url = (spotify.get("external_urls") or {}).get("spotify") or spotify_url
        images = spotify.get("images") or []
        photo = images[0].get("url") if images else None
        genres = spotify.get("genres") or genres
    elif spotify_url:
        match = re.search(r"/artist/([A-Za-z0-9]+)", spotify_url)
        spotify_id = match.group(1) if match else None

    socials = relation_data["socials"]
    if spotify_url:
        socials["spotify"] = spotify_url

    aliases = sorted({alias.get("name") for alias in mb.get("aliases", []) if alias.get("name")})
    metadata_spotify = {"id": spotify_id, "url": spotify_url} if spotify_id and spotify_url else None
    biography = short_description(relation_data["wikidataUrl"], relation_data["wikipediaUrl"])

    musicbrainz = {
        "mbid": mb["id"],
        "artistName": mb.get("name"),
        "area": (mb.get("area") or {}).get("name"),
        "country": mb.get("country"),
        "artistType": mb.get("type"),
        "disambiguation": mb.get("disambiguation") or None,
        "confidence": confidence,
        "status": "auto_confirmed",
        "matchMethod": method,
        "source": "MusicBrainz",
        "matchedAt": ts,
        "reviewedAt": None,
        "lastAttemptedAt": ts,
        "rejectedCandidateMbids": [],
        "reviewCandidates": [],
        "metadata": {
            "mbid": mb["id"],
            "artistName": mb.get("name"),
            "aliases": aliases,
            "artistType": mb.get("type"),
            "area": (mb.get("area") or {}).get("name"),
            "country": mb.get("country"),
            "disambiguation": mb.get("disambiguation") or None,
            "spotify": metadata_spotify,
            "lastAttemptedAt": ts,
            "lastSuccessfulAt": ts,
            "nextEligibleCheckAt": None,
            "errorCategory": None,
        },
    }

    if spotify_id and spotify_url:
        musicbrainz["spotify"] = {
            "id": spotify_id,
            "url": spotify_url,
            "artistName": spotify_name,
            "status": "confirmed",
            "matchMethod": "musicbrainz_url_relation",
            "confidence": 100,
            "matchedAt": ts,
            "lastAttemptedAt": ts,
            "lastSuccessfulAt": ts,
            "nextEligibleCheckAt": None,
            "errorCategory": None,
        }

    if ticketmaster:
        musicbrainz["ticketmaster"] = {
            "id": ticketmaster.get("id"),
            "attractionName": ticketmaster.get("name"),
            "url": ticketmaster.get("url") or None,
            "status": "confirmed",
            "matchMethod": "exact_music_attraction",
            "confidence": 100,
            "matchedAt": ts,
            "lastAttemptedAt": ts,
            "lastSuccessfulAt": ts,
            "nextEligibleCheckAt": None,
            "errorCategory": None,
        }

    return {
        "id": slugify(display_name),
        "name": display_name,
        "officialUrl": relation_data["officialUrl"],
        "photoUrl": photo,
        "genre": ", ".join(genres[:4]) if genres else None,
        "origin": make_origin(mb),
        "formedYear": begin_year(mb),
        "bio": biography,
        "socials": socials,
        "addedAt": ts,
        "enrichedAt": ts,
        "musicbrainz": musicbrainz,
        "structuredResearch": empty_research_state(),
    }


def merge_macklemore(solo: dict[str, Any], duo: dict[str, Any]) -> dict[str, Any]:
    """Attach duo provider identities without replacing existing solo fields."""
    record = copy.deepcopy(solo)
    solo_mb = record.get("musicbrainz") or {}
    duo_mb = duo.get("musicbrainz") or {}
    record.setdefault("providerIdentities", {})["musicbrainz"] = [
        {
            "role": "primary",
            "mbid": solo_mb.get("mbid"),
            "artistName": solo_mb.get("artistName") or record.get("name"),
        },
        {
            "role": "related_duo",
            "mbid": duo_mb.get("mbid"),
            "artistName": duo_mb.get("artistName") or "Macklemore & Ryan Lewis",
        },
    ]
    spotify_items = []
    for source, role in ((record, "primary"), (duo, "related_duo")):
        item = (source.get("musicbrainz") or {}).get("spotify")
        if item and item.get("id") and item.get("url"):
            spotify_items.append({
                "role": role,
                "id": item.get("id"),
                "url": item.get("url"),
                "artistName": item.get("artistName"),
            })
    if spotify_items:
        record["providerIdentities"]["spotify"] = spotify_items
    metadata = solo_mb.get("metadata")
    if isinstance(metadata, dict):
        aliases = set(metadata.get("aliases") or [])
        aliases.add("Macklemore & Ryan Lewis")
        metadata["aliases"] = sorted(aliases)
    return record


def validate(data: list[dict[str, Any]]) -> list[str]:
    errors: list[str] = []
    ids: dict[str, int] = {}
    names: dict[str, int] = {}
    for index, band in enumerate(data):
        if not isinstance(band, dict):
            errors.append(f"record {index}: not object")
            continue
        band_id = band.get("id")
        name = band.get("name")
        if not band_id or not name:
            errors.append(f"record {index}: missing id/name")
        ids[band_id] = ids.get(band_id, 0) + 1
        normalized = normalize_name(name or "")
        names[normalized] = names.get(normalized, 0) + 1
    errors.extend(f"duplicate id: {value}" for value, count in ids.items() if count > 1)
    errors.extend(f"duplicate normalized name: {value}" for value, count in names.items() if count > 1)
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--artists", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--limit", type=int, default=0, help="For controlled test runs; 0 means all")
    args = parser.parse_args()

    existing = json.loads(args.input.read_text(encoding="utf-8"))
    approved = json.loads(args.artists.read_text(encoding="utf-8"))
    existing_names = {normalize_name(item.get("name", "")) for item in existing}

    work = []
    for name in approved:
        if name == "Macklemore & Ryan Lewis":
            continue
        if normalize_name(name) in existing_names:
            continue
        if name not in work:
            work.append(name)
    if args.limit:
        work = work[:args.limit]

    token = spotify_token()
    additions: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    audit: list[dict[str, Any]] = []
    duo_record = None

    search_names = work + (["Macklemore & Ryan Lewis"] if "Macklemore & Ryan Lewis" in approved else [])
    for index, name in enumerate(search_names, 1):
        print(f"[{index}/{len(search_names)}] {name}", flush=True)
        try:
            override_mbid = EXPLICIT_MBIDS.get(name)
            if override_mbid:
                candidates = []
                selected = {"id": override_mbid, "name": name}
                method = "explicit_approved_mbid"
                confidence = 100
            else:
                candidates = musicbrainz_search(name)
                selected, method, confidence = select_candidate(name, candidates)
            if not selected:
                unresolved.append({
                    "name": name,
                    "reason": method,
                    "candidates": [
                        {
                            "mbid": candidate.artist.get("id"),
                            "name": candidate.artist.get("name"),
                            "score": candidate.score,
                            "type": candidate.artist.get("type"),
                            "country": candidate.artist.get("country"),
                            "disambiguation": candidate.artist.get("disambiguation"),
                        }
                        for candidate in candidates[:5]
                    ],
                })
                continue
            musicbrainz = musicbrainz_lookup(selected["id"])
            relations = parse_relations(musicbrainz)
            spotify = spotify_get_artist(relations["spotifyUrl"], token)
            ticketmaster = ticketmaster_search(name)
            record = build_record(name, musicbrainz, confidence, method, spotify, ticketmaster)
            audit.append({
                "name": name,
                "mbid": musicbrainz["id"],
                "musicbrainzName": musicbrainz.get("name"),
                "spotifyId": ((record.get("musicbrainz") or {}).get("spotify") or {}).get("id"),
                "ticketmasterId": ((record.get("musicbrainz") or {}).get("ticketmaster") or {}).get("id"),
                "officialUrl": record.get("officialUrl"),
                "socials": record.get("socials"),
                "missing": [
                    key
                    for key in ("officialUrl", "photoUrl", "genre", "origin", "formedYear", "bio")
                    if not record.get(key)
                ],
            })
            if name == "Macklemore & Ryan Lewis":
                duo_record = record
            else:
                additions.append(record)
        except Exception as exc:  # noqa: BLE001
            unresolved.append({"name": name, "reason": "error", "error": str(exc)})

    existing_out = copy.deepcopy(existing)
    if duo_record:
        merged = False
        for index, item in enumerate(additions):
            if item.get("name") == "Macklemore":
                additions[index] = merge_macklemore(item, duo_record)
                merged = True
                break
        if not merged:
            for index, item in enumerate(existing_out):
                if normalize_name(item.get("name", "")) == normalize_name("Macklemore"):
                    existing_out[index] = merge_macklemore(item, duo_record)
                    merged = True
                    break
        if not merged:
            unresolved.append({"name": "Macklemore", "reason": "combined_identity_target_missing"})

    final = existing_out + additions
    errors = validate(final)
    report = {
        "generatedAt": now_iso(),
        "inputCount": len(existing),
        "approvedNameCount": len(approved),
        "addedCount": len(additions),
        "outputCount": len(final),
        "unresolvedCount": len(unresolved),
        "validationErrors": errors,
        "unresolved": unresolved,
        "audit": audit,
        "notes": [
            "Existing records are copied unchanged except Macklemore, which is augmented with the approved Macklemore & Ryan Lewis provider identity while preserving all existing fields.",
            "No concerts are created.",
            "Structured research histories are initialized empty, not fabricated.",
            "Spotify and Ticketmaster enrichment require optional local environment credentials.",
        ],
    }
    args.output.write_text(json.dumps(final, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        key: report[key]
        for key in ("inputCount", "addedCount", "outputCount", "unresolvedCount", "validationErrors")
    }, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
