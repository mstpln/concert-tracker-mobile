#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import datetime as dt
import json
import os
import re
import time
import unicodedata
from pathlib import Path
from urllib.parse import quote, urlparse

import requests

MB = "https://musicbrainz.org/ws/2"
UA = "TheLiveVaultBulkEnricher/1.0 (single-user personal app)"
S = requests.Session()
S.headers.update({"User-Agent": UA, "Accept": "application/json"})


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def norm(value):
    value = unicodedata.normalize("NFKD", value or "")
    value = "".join(c for c in value if not unicodedata.combining(c))
    value = value.casefold().replace("&", " and ")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value).split())


def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", norm(value)).strip("-") or "artist"


def get_json(url, params=None, mb=False, retries=4):
    last = None
    for attempt in range(retries):
        try:
            if mb:
                time.sleep(1.1)
            r = S.get(url, params=params, timeout=40)
            if r.status_code in (429, 503):
                time.sleep(2 ** attempt + 1)
                continue
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            last = exc
            if attempt + 1 < retries:
                time.sleep(2 ** attempt + 1)
    raise RuntimeError(f"GET failed: {url}: {last}")


def host(url):
    h = urlparse(url).netloc.lower().split(":")[0]
    return h[4:] if h.startswith("www.") else h


def search_artist(name):
    data = get_json(f"{MB}/artist/", {"query": f'artist:"{name.replace(chr(34), "")}"', "fmt": "json", "limit": 10}, mb=True)
    target = norm(name)
    items = []
    for a in data.get("artists", []):
        aliases = [x.get("name", "") for x in a.get("aliases", [])]
        exact = norm(a.get("name")) == target
        alias_exact = any(norm(x) == target for x in aliases)
        items.append((exact, alias_exact, int(a.get("score", 0)), a))
    items.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)
    if not items:
        return None, "no_results", 0, []
    top = items[0]
    second = items[1][2] if len(items) > 1 else -1
    if top[0] and top[2] >= 95 and (top[2] - second >= 5 or not items[1][0]):
        return top[3], "exact_name", min(100, top[2]), items
    if top[1] and top[2] >= 95 and top[2] - second >= 8:
        return top[3], "exact_alias", min(99, top[2]), items
    return None, "ambiguous", top[2], items


def lookup(mbid):
    return get_json(f"{MB}/artist/{mbid}", {"inc": "aliases+genres+url-rels", "fmt": "json"}, mb=True)


def relations(mb):
    official = None
    spotify = None
    wikidata = None
    wikipedia = None
    socials = {}
    domains = {
        "instagram.com": "instagram", "facebook.com": "facebook",
        "twitter.com": "x", "x.com": "x", "tiktok.com": "tiktok",
        "youtube.com": "youtube", "youtu.be": "youtube",
    }
    for rel in mb.get("relations", []):
        if rel.get("target-type") != "url":
            continue
        url = (rel.get("url") or {}).get("resource")
        if not url:
            continue
        h = host(url)
        if rel.get("type") == "official homepage" and not official:
            official = url
        if h == "open.spotify.com" and "/artist/" in url:
            spotify = url
        if h.endswith("wikidata.org"):
            wikidata = url
        if h.endswith("wikipedia.org"):
            wikipedia = url
        for domain, key in domains.items():
            if h == domain or h.endswith("." + domain):
                socials.setdefault(key, url)
    if spotify:
        socials["spotify"] = spotify
    return official, spotify, wikidata, wikipedia, socials


def spotify_token():
    cid = os.getenv("SPOTIFY_CLIENT_ID")
    secret = os.getenv("SPOTIFY_CLIENT_SECRET")
    if not cid or not secret:
        return None
    r = requests.post("https://accounts.spotify.com/api/token", data={"grant_type": "client_credentials"}, auth=(cid, secret), timeout=30)
    r.raise_for_status()
    return r.json()["access_token"]


def spotify_artist(url, token):
    if not url or not token:
        return None
    m = re.search(r"/artist/([A-Za-z0-9]+)", url)
    if not m:
        return None
    r = requests.get(f"https://api.spotify.com/v1/artists/{m.group(1)}", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    return r.json()


def ticketmaster(name):
    key = os.getenv("TICKETMASTER_API_KEY")
    if not key:
        return None
    data = get_json("https://app.ticketmaster.com/discovery/v2/attractions.json", {"apikey": key, "keyword": name, "classificationName": "music", "size": 10})
    attrs = (((data or {}).get("_embedded") or {}).get("attractions") or [])
    exact = [x for x in attrs if norm(x.get("name")) == norm(name)]
    return exact[0] if len(exact) == 1 else None


def description(wikidata, wikipedia):
    if wikidata:
        m = re.search(r"/(Q\d+)(?:$|[?#])", wikidata)
        if m:
            qid = m.group(1)
            try:
                data = get_json(f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json")
                text = data.get("entities", {}).get(qid, {}).get("descriptions", {}).get("en", {}).get("value")
                if text:
                    return text[:1].upper() + text[1:].rstrip(".") + "."
            except Exception:
                pass
    if wikipedia:
        try:
            p = urlparse(wikipedia)
            title = p.path.split("/wiki/", 1)[1]
            data = get_json(f"https://{p.netloc}/api/rest_v1/page/summary/{quote(title)}")
            return (data.get("extract") or "").split("\n", 1)[0].strip() or None
        except Exception:
            pass
    return None


def origin(mb):
    begin = (mb.get("begin-area") or {}).get("name")
    area = (mb.get("area") or {}).get("name")
    country = mb.get("country")
    values = []
    for value in (begin, area, country):
        if value and value not in values:
            values.append(value)
    return ", ".join(values) or None


def empty_research():
    empty = {"status": "not_started", "knownKeys": [], "continuation": None, "lastAttemptedAt": None, "lastSuccessfulAt": None, "nextEligibleCheckAt": None, "errorCategory": None}
    return {"releases": {"musicbrainz": copy.deepcopy(empty), "spotify": copy.deepcopy(empty), "knownAlerts": [], "observations": [], "canonical": []}, "routing": {"groqFingerprints": []}}


def build_record(display_name, mb, confidence, method, sp, tm):
    ts = now()
    official, spotify_url, wikidata, wikipedia, socials = relations(mb)
    spotify_id = None
    spotify_name = mb.get("name")
    photo = None
    genres = [g.get("name") for g in mb.get("genres", []) if g.get("name")]
    if sp:
        spotify_id = sp.get("id")
        spotify_name = sp.get("name")
        spotify_url = (sp.get("external_urls") or {}).get("spotify") or spotify_url
        photo = ((sp.get("images") or [{}])[0]).get("url")
        genres = sp.get("genres") or genres
    elif spotify_url:
        m = re.search(r"/artist/([A-Za-z0-9]+)", spotify_url)
        spotify_id = m.group(1) if m else None
    if spotify_url:
        socials["spotify"] = spotify_url
    aliases = sorted({x.get("name") for x in mb.get("aliases", []) if x.get("name")})
    meta_spotify = {"id": spotify_id, "url": spotify_url} if spotify_id and spotify_url else None
    musicbrainz = {
        "mbid": mb["id"], "artistName": mb.get("name"), "area": (mb.get("area") or {}).get("name"),
        "country": mb.get("country"), "artistType": mb.get("type"), "disambiguation": mb.get("disambiguation") or None,
        "confidence": confidence, "status": "auto_confirmed", "matchMethod": method, "source": "MusicBrainz",
        "matchedAt": ts, "reviewedAt": None, "lastAttemptedAt": ts, "rejectedCandidateMbids": [], "reviewCandidates": [],
        "metadata": {"mbid": mb["id"], "artistName": mb.get("name"), "aliases": aliases, "artistType": mb.get("type"),
                     "area": (mb.get("area") or {}).get("name"), "country": mb.get("country"),
                     "disambiguation": mb.get("disambiguation") or None, "spotify": meta_spotify,
                     "lastAttemptedAt": ts, "lastSuccessfulAt": ts, "nextEligibleCheckAt": None, "errorCategory": None},
    }
    if spotify_id and spotify_url:
        musicbrainz["spotify"] = {"id": spotify_id, "url": spotify_url, "artistName": spotify_name, "status": "confirmed",
                                    "matchMethod": "musicbrainz_url_relation", "confidence": 100, "matchedAt": ts,
                                    "lastAttemptedAt": ts, "lastSuccessfulAt": ts, "nextEligibleCheckAt": None, "errorCategory": None}
    if tm:
        musicbrainz["ticketmaster"] = {"id": tm.get("id"), "attractionName": tm.get("name"), "url": tm.get("url"),
                                         "status": "confirmed", "matchMethod": "exact_music_attraction", "confidence": 100,
                                         "matchedAt": ts, "lastAttemptedAt": ts, "lastSuccessfulAt": ts,
                                         "nextEligibleCheckAt": None, "errorCategory": None}
    year = ((mb.get("life-span") or {}).get("begin") or "").split("-", 1)[0]
    return {"id": slug(display_name), "name": display_name, "officialUrl": official, "photoUrl": photo,
            "genre": ", ".join(genres[:4]) if genres else None, "origin": origin(mb),
            "formedYear": year if re.fullmatch(r"\d{4}", year) else None,
            "bio": description(wikidata, wikipedia), "socials": socials, "addedAt": ts, "enrichedAt": ts,
            "musicbrainz": musicbrainz, "structuredResearch": empty_research()}


def merge_macklemore(solo, duo):
    record = copy.deepcopy(solo)
    record["id"] = "macklemore"
    record["name"] = "Macklemore"
    record["providerIdentities"] = {
        "musicbrainz": [
            {"role": "primary", "mbid": solo["musicbrainz"]["mbid"], "artistName": solo["musicbrainz"]["artistName"]},
            {"role": "related_duo", "mbid": duo["musicbrainz"]["mbid"], "artistName": duo["musicbrainz"]["artistName"]},
        ],
        "spotify": [],
    }
    for source, role in ((solo, "primary"), (duo, "related_duo")):
        item = (source.get("musicbrainz") or {}).get("spotify")
        if item:
            record["providerIdentities"]["spotify"].append({"role": role, "id": item.get("id"), "url": item.get("url"), "artistName": item.get("artistName")})
    aliases = set(record["musicbrainz"]["metadata"].get("aliases") or [])
    aliases.add("Macklemore & Ryan Lewis")
    record["musicbrainz"]["metadata"]["aliases"] = sorted(aliases)
    return record


def validate(items):
    errors = []
    ids = {}
    names = {}
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append(f"record {i}: not object")
            continue
        if not item.get("id") or not item.get("name"):
            errors.append(f"record {i}: missing id/name")
        ids[item.get("id")] = ids.get(item.get("id"), 0) + 1
        names[norm(item.get("name"))] = names.get(norm(item.get("name")), 0) + 1
    errors.extend(f"duplicate id: {k}" for k, v in ids.items() if v > 1)
    errors.extend(f"duplicate normalized name: {k}" for k, v in names.items() if v > 1)
    return errors


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True, type=Path)
    p.add_argument("--artists", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--report", required=True, type=Path)
    args = p.parse_args()
    existing = json.loads(args.input.read_text(encoding="utf-8"))
    approved = json.loads(args.artists.read_text(encoding="utf-8"))
    existing_names = {norm(x.get("name")) for x in existing}
    work = []
    for name in approved:
        if name == "Macklemore & Ryan Lewis" or norm(name) in existing_names or name in work:
            continue
        work.append(name)
    token = spotify_token()
    additions = []
    unresolved = []
    audit = []
    duo = None
    search_names = work + (["Macklemore & Ryan Lewis"] if "Macklemore" in work else [])
    for index, name in enumerate(search_names, 1):
        print(f"[{index}/{len(search_names)}] {name}", flush=True)
        try:
            selected, method, confidence, candidates = search_artist(name)
            if not selected:
                unresolved.append({"name": name, "reason": method, "candidates": [
                    {"mbid": c[3].get("id"), "name": c[3].get("name"), "score": c[2], "type": c[3].get("type"),
                     "country": c[3].get("country"), "disambiguation": c[3].get("disambiguation")} for c in candidates[:5]]})
                continue
            mb = lookup(selected["id"])
            _, spotify_url, _, _, _ = relations(mb)
            sp = spotify_artist(spotify_url, token)
            tm = ticketmaster(name)
            record = build_record(name, mb, confidence, method, sp, tm)
            audit.append({"name": name, "mbid": mb["id"], "spotifyId": ((record.get("musicbrainz") or {}).get("spotify") or {}).get("id"),
                          "ticketmasterId": ((record.get("musicbrainz") or {}).get("ticketmaster") or {}).get("id"),
                          "officialUrl": record.get("officialUrl"), "socials": record.get("socials"),
                          "missing": [k for k in ("officialUrl", "photoUrl", "genre", "origin", "formedYear", "bio") if not record.get(k)]})
            if name == "Macklemore & Ryan Lewis":
                duo = record
            else:
                additions.append(record)
        except Exception as exc:
            unresolved.append({"name": name, "reason": "error", "error": str(exc)})
    if duo:
        for i, item in enumerate(additions):
            if item["name"] == "Macklemore":
                additions[i] = merge_macklemore(item, duo)
                break
    final = copy.deepcopy(existing) + additions
    errors = validate(final)
    report = {"generatedAt": now(), "inputCount": len(existing), "approvedNameCount": len(approved),
              "addedCount": len(additions), "outputCount": len(final), "unresolvedCount": len(unresolved),
              "validationErrors": errors, "unresolved": unresolved, "audit": audit,
              "notes": ["Existing records are copied unchanged.", "No concerts are created.",
                        "Research history is initialized empty rather than fabricated.",
                        "Output is an artifact only and is not written to Cloudflare or production."]}
    args.output.write_text(json.dumps(final, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("inputCount", "addedCount", "outputCount", "unresolvedCount", "validationErrors")}, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
