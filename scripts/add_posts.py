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
                The hourly update job must write a caption for each new
                post. Entries without a caption are kept; the site falls
                back to a trimmed copy of the post text.
    added_at    Optional. When the post was first added to this
                collection. Set automatically (UTC) if omitted.

The script reads data/videos.json from the repo root (creating an empty
list if the file does not exist yet), inserts only posts whose id is not
already present, sorts the collection newest-first by created_at, writes
the file back, prints how many posts were added, and exits 0 even when
nothing is new.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "data" / "videos.json"

REQUIRED = ("id",)
PASSTHROUGH = ("id", "url", "author", "text", "created_at", "caption", "added_at")


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_json(path: Path):
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, list):
        raise SystemExit(f"{path} must contain a JSON array")
    return data


def normalize(post: dict) -> dict:
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
    # Keep caption when provided (including an explicit empty string as absent)
    caption = post.get("caption")
    if caption is not None and str(caption).strip() != "":
        out["caption"] = str(caption).strip()
    if post.get("added_at"):
        out["added_at"] = str(post["added_at"])
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

    existing = load_json(DATA_PATH)
    seen = {str(item.get("id")) for item in existing if item.get("id") is not None}

    candidates = load_json(candidates_path)
    added = 0
    now = utc_now()
    for raw in candidates:
        post = normalize(raw)
        if post["id"] in seen:
            continue
        if "added_at" not in post:
            post["added_at"] = now
        existing.append(post)
        seen.add(post["id"])
        added += 1

    existing.sort(key=sort_key, reverse=True)
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with DATA_PATH.open("w", encoding="utf-8") as fh:
        json.dump(existing, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    if added == 0:
        print("Added 0 posts (nothing new).")
    elif added == 1:
        print("Added 1 post.")
    else:
        print(f"Added {added} posts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
