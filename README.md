# youtube-notion-sync
A set of scripts for Github Actions to populate a Notion database &amp; calendar with Youtube channel uploads


# YouTube → Notion Calendar Sync (GitHub Actions)

This repository implements a **scheduled, append-only synchronization pipeline** that ingests **published YouTube uploads** into a **Notion database** and renders them via a **calendar view**.

---

## Pipeline Overview

### Execution
- **Runtime**: GitHub Actions (`ubuntu-latest`)
- **Schedule**: Weekly cron + manual `workflow_dispatch`
- **Language**: Node.js 18

---

### Source
- **API**: YouTube Data API v3
- **Endpoints used**:
  - `channels.list` – resolve uploads playlist
  - `playlistItems.list` – enumerate uploads
  - `videos.list` – retrieve `contentDetails.duration`
- **Scope**:
  - Published videos only
  - Excludes scheduled, private, and upcoming videos

---

### Sink
- **API**: Notion API (`2022-06-28`)
- **Target**: Database-backed calendar view
- **Write mode**: Insert-only (no updates)

---

## Data Model (Notion)

Each YouTube video is written as a single database row:

| Property       | Type   | Notes |
|---------------|--------|------|
| Name           | Title  | Video title |
| Publish Date   | Date   | ISO-8601, drives calendar |
| Channel        | Select | Logical channel name |
| Video URL      | URL    | Canonical watch URL |
| Video ID       | Text   | Unique deduplication key |
| Length         | Number | Total duration in seconds |
| Imported At    | Date   | Ingestion timestamp |

---

## Backfill & Rate Characteristics

- **Max inserts per run**: 100 total (round-robin across channels)

### YouTube API
- `playlistItems.list`: 1 quota unit per page (max 50 videos)
- `videos.list`: Batched (≤50 video IDs per request)
- **Typical run cost**: <10 quota units

### Notion API
- Serialized inserts
- Throttle: ~350 ms per write
- Operates safely under Notion’s ~3 requests/sec limit

Historical backfill progresses automatically over successive runs until all uploads are ingested.

---

## Idempotency & Guarantees

- Deduplication via **Video ID**
- Append-only writes
- No mutation of existing rows
- Publish date treated as immutable
- Safe to re-run at any time

## Configurations

- NOTION_TOKEN
- NOTION_DATABASE_ID
- YOUTUBE_API_KEY
- CHANNEL_ID_1
- CHANNEL_ID_2
- CHANNEL_ID_3
