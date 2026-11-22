# FSD v15 videos

A public, automatically growing collection of X (Twitter) posts that include real video of Tesla Full Self-Driving version 15 in action.

Live site: https://silvertibby.github.io/fsd-v15-videos/

The site is static. There is no build step, no tracking, and no sign-in. `index.html` loads `data/videos.json` and `data/tags.json`, embeds each post with X's official `blockquote.twitter-tweet` widget so the videos play inline, and lazy-loads cards as you scroll.

## Search and filters

The default view is **All** videos, newest first.

- **Search box:** matches tag names (id or label), the caption, the author handle, and the post text. Case-insensitive.
- **Tag bar:** every tag in the vocabulary that has at least one video, with a count. Click a tag to add it to the filter; click it again to remove it. The All chip clears tag filters and returns to the full list (the search box, if filled, stays until you Clear).
- **Chips on each card:** also clickable. They toggle the same tag filter as the bar.
- **Several tags:** videos match *any* selected tag by default. When two or more tags are selected, an Any / All toggle appears. All means a video must have every selected tag.
- **Result count:** when a search or tag filter is active, the page shows how many videos match (for example, “Showing 6 of 82 videos”).
- **Clear:** removes the search, all selected tags, and the match mode.
- **Shareable URL:** filters are stored in the query string, for example `?tag=parking`, `?tag=parking&tag=highway`, `?q=rodeo`, or `?tag=parking&tag=highway&match=all`.

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
| `tags` | Array of tag ids from `data/tags.json`. Every video has at least one. |
| `media_keys` | Optional. X media keys, used to catch the same clip in another post. |
| `source_post_ids` | Optional. Id of a quoted or source post the video was taken from. |

`data/tags.json` is the fixed tag vocabulary (`id`, `label`, and a short `definition`). Later scrapes must reuse exactly these ids. `general-driving` is the fallback when no more specific tag applies.

`data/excluded.json` holds posts that were found but not shown: quality-filter rejects and duplicates, each with a `reason` such as `not driving footage: talking head` or `duplicate of <id>`.

## Adding new posts

From the repo root:

```bash
python3 scripts/add_posts.py path/to/candidates.json
```

### What each scrape must do first

1. **Quality filter.** Keep only real footage of FSD v15 actually driving: in-car, the car’s screen, or exterior footage of the car on v15. Remove influencer talking heads, summary or recap videos, reaction videos, commentary or news segments, memes, ads, and anything that does not show v15 in action. Judge from the post text, the caption, and any media or context you have. When unsure, keep the post and note the uncertainty; do not guess-delete. Write rejected posts to `data/excluded.json` with a reason.
2. **Caption and tags.** Write a one-sentence `caption` for every new post, and assign `tags` from `data/tags.json` (at least one; use `general-driving` if nothing else fits).
3. **Dedupe.** Never add the same video twice. Match on post id or URL, on the same media (media key or video URL), on quote posts or reposts of a video already on the site, and on near-identical content (the same author posting the same clip again, or posts whose caption and text describe the same clip). Keep the original or earliest post.

Then run the merge script. It skips anything already in `videos.json` or `excluded.json` and also catches media-level duplicates it can detect (same media key, video URL, or source post id). Those are appended to `excluded.json` as `duplicate of <id>`. Missing tags default to `["general-driving"]`. Unknown tags print a warning and are dropped.

### Update cycle

```bash
cd /workspace/fsd-v15-videos
git pull --rebase origin main
python3 scripts/add_posts.py path/to/candidates.json
git add data/videos.json data/excluded.json data/tags.json
git commit -m "Add FSD v15 videos"
git push origin main
```

Pull and rebase right before you commit. If a scheduled scrape landed in the meantime, keep all posts and keep existing tags when resolving conflicts. GitHub Pages serves `main` from the repo root, so the live site updates after the Pages build finishes. If the merge printed `Added 0 posts (nothing new).`, you can skip the commit.

## X search queries

These queries worked best for the initial fill. All of them use `has:videos -is:retweet`. `"FSD v15"` is case-insensitive, so a separate `"FSD V15"` query is not needed.

Best default:

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

Request `expansions=author_id,attachments.media_keys` and `media.fields=type` so you can keep only posts whose attached media includes a `video`, and so later scrapes can pass `media_keys` into the merger. Stay within the search limits (30 calls/minute, 1000/day).
