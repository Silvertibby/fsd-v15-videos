#!/usr/bin/env python3
"""Merge new X posts into data/videos.json.

Usage:
    python3 scripts/add_posts.py path/to/candidates.json

candidates.json must be a JSON array of post objects. Each object should
include the same fields used in data/videos.json:

    id          Post id (string). Required. Duplicates are skipped.
    url         Canonical post URL (https://x.com/<handle>/status/<id>).
    author      Author handle without a leading @.
    text        Full post text.
    created_at  Original post timestamp, preferably ISO-8601 UTC.
    caption     Optional. One plain sentence describing what the video
                shows, written for a reader (not the raw post text).
                Each scrape must write a caption for every new post.
                Entries without a caption are kept; the site falls back
                to a trimmed copy of the post text.
    tags        Optional. Array of tag ids from data/tags.json (for
                example "parking", "general-driving"). Labels such as
                "General driving" are also accepted and stored as ids.
                Each scrape must assign tags from that vocabulary.
                Missing or empty tags default to ["general-driving"].
                Unknown tags are dropped with a warning.
    added_at    Optional. When the post was first added to this
                collection. Set automatically (UTC) if omitted.
    media_keys  Optional. X media keys for the attached video, used to
                catch the same clip shared in another post.
    media_urls  Optional. Direct or x.com video URLs for the same purpose.
    source_post_ids / media_source_tweet_id
                Optional. Id of the post this video was quoted or taken
                from.

Before calling this script, each scrape must:

    1. Keep only real footage of FSD v15 actually driving (in-car,
       screen, or exterior footage of the car on v15). Drop talking
       heads, recaps, reactions, commentary, news, memes, and ads.
       When unsure, keep the post and note the uncertainty; do not
       guess-delete. Write rejected posts to data/excluded.json with a
       reason such as "not driving footage: talking head".
    2. Assign a caption and tags from data/tags.json.
    3. Avoid adding a clip that is already on the site.

The script then reads data/videos.json and data/excluded.json, skips
anything already present (by post id or URL), and also skips media-level
duplicates it can detect (same media key, video URL, or source post).
Those media duplicates are appended to data/excluded.json with a reason
of "duplicate of <id>". It sorts the collection newest-first by
created_at, writes the files back, prints how many posts were added,
and exits 0 even when nothing is new.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "data" / "videos.json"
EXCLUDED_PATH = ROOT / "data" / "excluded.json"
TAGS_PATH = ROOT / "data" / "tags.json"
DEFAULT_TAG = "general-driving"


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_json(path: Path, default):
    if not path.exists():
        return default
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    return data


def load_list(path: Path) -> list:
    data = load_json(path, [])
    if not isinstance(data, list):
        raise SystemExit(f"{path} must contain a JSON array")
    return data


def normalize_url(url: str) -> str:
    if not url:
        return ""
    url = url.lower().split("?")[0].split("#")[0].rstrip("/")
    url = url.replace("https://twitter.com/", "https://x.com/")
    url = url.replace("http://x.com/", "https://x.com/")
    url = url.replace("http://twitter.com/", "https://x.com/")
    return url


def status_id_from_url(url: str) -> str | None:
    m = re.search(r"/status/(\d+)", url or "")
    return m.group(1) if m else None


def write_list(path: Path, data: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def load_tag_maps():
    raw = load_json(TAGS_PATH, [])
    if not isinstance(raw, list):
        raise SystemExit(f"{TAGS_PATH} must contain a JSON array")
    by_id = {}
    by_alias = {}
    for tag in raw:
        if not isinstance(tag, dict) or not tag.get("id"):
            continue
        tid = str(tag["id"])
        by_id[tid] = tag
        by_alias[tid.lower()] = tid
        by_alias[tid.replace("-", " ").lower()] = tid
        by_alias[tid.replace("-", "_").lower()] = tid
        label = str(tag.get("label") or "").strip()
        if label:
            by_alias[label.lower()] = tid
    if DEFAULT_TAG not in by_id and by_id:
        # Fall back to the last vocabulary entry if the usual default is missing.
        pass
    return by_id, by_alias


def normalize_tags(raw, by_alias: dict, post_id: str) -> list[str]:
    if raw is None or raw == [] or raw == "":
        return [DEFAULT_TAG]
    if isinstance(raw, str):
        values = [raw]
    elif isinstance(raw, list):
        values = raw
    else:
        print(f"warning: ignoring malformed tags on post {post_id}", file=sys.stderr)
        return [DEFAULT_TAG]
    out = []
    for value in values:
        if value is None or str(value).strip() == "":
            continue
        key = str(value).strip().lower()
        tid = by_alias.get(key)
        if not tid:
            print(
                f"warning: unknown tag {value!r} on post {post_id}; ignored",
                file=sys.stderr,
            )
            continue
        if tid not in out:
            out.append(tid)
    if not out:
        print(
            f"warning: no valid tags on post {post_id}; defaulting to {DEFAULT_TAG!r}",
            file=sys.stderr,
        )
        return [DEFAULT_TAG]
    return out


def collect_media(post: dict) -> tuple[list[str], list[str], list[str]]:
    keys = []
    for item in post.get("media_keys") or []:
        if item and str(item) not in keys:
            keys.append(str(item))
    if post.get("media_key") and str(post["media_key"]) not in keys:
        keys.append(str(post["media_key"]))
    urls = []
    for item in post.get("media_urls") or post.get("video_urls") or []:
        n = normalize_url(str(item))
        if n and n not in urls:
            urls.append(n)
    for item in (post.get("url"), post.get("post_url")):
        if item:
            n = normalize_url(str(item))
            if n and n not in urls:
                urls.append(n)
    sources = []
    for item in post.get("source_post_ids") or post.get("source_ids") or []:
        if item and str(item) not in sources:
            sources.append(str(item))
    src = post.get("media_source_tweet_id") or post.get("source_post_id")
    if src and str(src) not in sources:
        sources.append(str(src))
    return keys, urls, sources


def index_existing(posts: list) -> dict:
    ids = set()
    urls = set()
    media_keys = {}
    media_urls = {}
    for post in posts:
        pid = str(post.get("id") or "")
        if pid:
            ids.add(pid)
        url = normalize_url(str(post.get("url") or ""))
        if url:
            urls.add(url)
        keys, vurls, sources = collect_media(post)
        for key in keys:
            media_keys.setdefault(key, pid)
        for vurl in vurls:
            media_urls.setdefault(vurl, pid)
            sid = status_id_from_url(vurl)
            if sid:
                ids.add(sid)
        for src in sources:
            ids.add(src)
    return {"ids": ids, "urls": urls, "media_keys": media_keys, "media_urls": media_urls}


def find_duplicate(post: dict, index: dict) -> str | None:
    pid = post.get("id")
    if pid and pid in index["ids"]:
        return str(pid)
    url = normalize_url(post.get("url") or "")
    if url and url in index["urls"]:
        return index["media_urls"].get(url) or status_id_from_url(url) or url
    keys, vurls, sources = collect_media(post)
    for key in keys:
        if key in index["media_keys"]:
            return index["media_keys"][key]
    for vurl in vurls:
        if vurl in index["media_urls"]:
            return index["media_urls"][vurl]
        sid = status_id_from_url(vurl)
        if sid and sid in index["ids"]:
            return sid
    for src in sources:
        if src in index["ids"]:
            return src
        if src in index["media_keys"]:
            return index["media_keys"][src]
    return None


def remember(index: dict, post: dict) -> None:
    pid = post["id"]
    index["ids"].add(pid)
    url = normalize_url(post.get("url") or "")
    if url:
        index["urls"].add(url)
        index["media_urls"].setdefault(url, pid)
    keys, vurls, sources = collect_media(post)
    for key in keys:
        index["media_keys"].setdefault(key, pid)
    for vurl in vurls:
        index["media_urls"].setdefault(vurl, pid)
        sid = status_id_from_url(vurl)
        if sid:
            index["ids"].add(sid)
    for src in sources:
        index["ids"].add(src)


def normalize(post: dict, by_alias: dict) -> dict:
    if not isinstance(post, dict):
        raise SystemExit("Each candidate must be a JSON object")
    pid = post.get("id") or post.get("post_id") or post.get("tweet_id")
    if pid is None or str(pid).strip() == "":
        raise SystemExit("Each candidate needs an id")
    out = {"id": str(pid)}
    url = post.get("url") or post.get("post_url")
    if url:
        out["url"] = str(url)
    author = post.get("author") or post.get("handle") or post.get("username")
    if author:
        out["author"] = str(author).lstrip("@")
    if "text" in post and post["text"] is not None:
        out["text"] = str(post["text"])
    if post.get("created_at"):
        out["created_at"] = str(post["created_at"])
    caption = post.get("caption")
    if caption is not None and str(caption).strip() != "":
        out["caption"] = str(caption).strip()
    if post.get("added_at"):
        out["added_at"] = str(post["added_at"])
    out["tags"] = normalize_tags(post.get("tags"), by_alias, out["id"])
    keys, vurls, sources = collect_media(post)
    if keys:
        out["media_keys"] = keys
    if sources:
        out["source_post_ids"] = sources
    # Keep candidate media URLs that are actual video links, not just the post URL
    extra_urls = [
        u
        for u in vurls
        if "/video/" in u or "/photo/" in u
    ]
    if extra_urls:
        out["media_urls"] = extra_urls
    return out


def sort_key(post: dict) -> str:
    return post.get("created_at") or post.get("added_at") or post.get("id") or ""


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] in {"-h", "--help"}:
        print(__doc__.strip(), file=sys.stderr if len(argv) != 2 else sys.stdout)
        return 0 if len(argv) == 2 else 2

    candidates_path = Path(argv[1])
    if not candidates_path.exists():
        raise SystemExit(f"File not found: {candidates_path}")

    _, by_alias = load_tag_maps()
    if DEFAULT_TAG not in set(by_alias.values()):
        raise SystemExit(f"{TAGS_PATH} must define a {DEFAULT_TAG!r} tag")

    existing = load_list(DATA_PATH)
    excluded = load_list(EXCLUDED_PATH)
    index = index_existing(existing + excluded)

    candidates = load_list(candidates_path)
    added = 0
    skipped_dupes = 0
    now = utc_now()
    for raw in candidates:
        post = normalize(raw, by_alias)
        dupe_of = find_duplicate(post, index)
        if dupe_of:
            already_excluded = any(str(item.get("id")) == post["id"] for item in excluded)
            already_kept = any(str(item.get("id")) == post["id"] for item in existing)
            if not already_excluded and not already_kept:
                rec = dict(post)
                rec["reason"] = f"duplicate of {dupe_of}"
                if "added_at" not in rec:
                    rec["added_at"] = now
                excluded.append(rec)
                remember(index, post)
                skipped_dupes += 1
            continue
        if "added_at" not in post:
            post["added_at"] = now
        existing.append(post)
        remember(index, post)
        added += 1

    existing.sort(key=sort_key, reverse=True)
    excluded.sort(key=sort_key, reverse=True)
    write_list(DATA_PATH, existing)
    write_list(EXCLUDED_PATH, excluded)

    if added == 0:
        print("Added 0 posts (nothing new).")
    elif added == 1:
        print("Added 1 post.")
    else:
        print(f"Added {added} posts.")
    if skipped_dupes:
        print(f"Recorded {skipped_dupes} media or URL duplicate(s) in data/excluded.json.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
