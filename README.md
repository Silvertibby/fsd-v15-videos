# FSD v15 videos

A public, automatically growing collection of X (Twitter) posts that include video of Tesla Full Self-Driving version 15.

Live site: https://silvertibby.github.io/fsd-v15-videos/

The site is static. There is no build step, no tracking, and no sign-in. `index.html` loads `data/videos.json` and embeds each post with X's official `blockquote.twitter-tweet` widget so the videos play inline. Cards are lazy-loaded as you scroll.

## Data

`data/videos.json` is a JSON array, newest posts first (by `created_at`). Each object has:

| Field | Meaning |
| --- | --- |
| `id` | Post id. Used for deduping. |
| `url` | Canonical post URL (`https://x.com/<handle>/status/<id>`). |
| `author` | Author handle, without a leading `@`. |
| `text` | Full post text. |
| `created_at` | Original post time, ISO-8601 UTC. |
| `added_at` | When the post was first added to this collection, ISO-8601 UTC. |
| `caption` | One plain sentence describing what the video shows, written for a reader. Not the raw post text. |

The hourly update job **must write a `caption` for every new post**. Entries without a caption are still kept; the site then falls back to a trimmed copy of the post text.

## Adding new posts

From the repo root:

```bash
python3 scripts/add_posts.py path/to/candidates.json
```

`candidates.json` is a JSON array of objects with the same fields as above. `caption` is expected for each new post but is optional for the merger. `added_at` is filled in automatically when omitted.

The script merges in only new ids, sorts the file newest first, prints how many posts were added, and exits `0` even when nothing is new.

### Hourly update cycle

1. Search X for new FSD v15 video posts (queries below). Prefer `since_id` set to the newest `id` already in `data/videos.json`, or a `start_time` just before the latest `created_at`, so you only look at new posts.
2. Keep posts that actually contain a video and are about Tesla FSD version 15. Drop ads, memes, and footage of older FSD versions.
3. Write a `candidates.json` file. For each post include `id`, `url`, `author`, `text`, `created_at`, and a one-sentence `caption` describing what the video shows (for example, "Highway drive with an automatic lane change and exit, night").
4. Merge and publish:

```bash
cd /workspace/fsd-v15-videos
python3 scripts/add_posts.py path/to/candidates.json
git add data/videos.json
git commit -m "Add FSD v15 videos"
git push origin main
```

GitHub Pages serves `main` from the repo root, so the live site updates after the Pages build finishes. If the merge printed `Added 0 posts (nothing new).`, you can skip the commit.

## X search queries

These queries worked best for the initial fill. All of them use `has:videos -is:retweet`. `"FSD v15"` is case-insensitive, so a separate `"FSD V15"` query is not needed.

Best default (use this every hour):

```
"FSD v15" has:videos -is:retweet
```

Also run these; they catch posts the first query misses:

```
"FSD 15" has:videos -is:retweet
"FSD (Supervised) v15" has:videos -is:retweet
(FSDv15 OR #FSDv15 OR "FSD v15.0" OR "FSD 15.0") has:videos -is:retweet
from:Tesla ("FSD v15" OR "FSD 15") has:videos -is:retweet
from:elonmusk ("FSD v15" OR "FSD 15" OR v15) has:videos -is:retweet
```

Request `expansions=author_id,attachments.media_keys` and `media.fields=type` so you can keep only posts whose attached media includes a `video`. Stay within the search limits (30 calls/minute, 1000/day).
