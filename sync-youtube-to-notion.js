/**
 * Sync published YouTube uploads into a Notion database (append-only).
 * - 3 channels
 * - 100 videos total per run
 * - Published videos only
 * - Incremental historical backfill
 * - Stores length in seconds
 */

const fetch = require("node-fetch");

const {
  NOTION_TOKEN,
  NOTION_DATABASE_ID,
  YOUTUBE_API_KEY,
  CHANNEL_ID_1,
  CHANNEL_ID_2,
  CHANNEL_ID_3
} = process.env;

if (
  !NOTION_TOKEN ||
  !NOTION_DATABASE_ID ||
  !YOUTUBE_API_KEY ||
  !CHANNEL_ID_1 ||
  !CHANNEL_ID_2 ||
  !CHANNEL_ID_3
) {
  throw new Error("Missing required environment variables.");
}

const CHANNELS = [
  { name: "Cherrius", id: CHANNEL_ID_1 },
  { name: "CherriusClips", id: CHANNEL_ID_2 },
  { name: "CherriusPlays", id: CHANNEL_ID_3 }
];

const MAX_TOTAL_VIDEOS = 100;
const PAGE_SIZE = 50;
const NOTION_THROTTLE_MS = 350;

/* ------------------ helpers ------------------ */

const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseISODurationToSeconds(iso) {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const h = parseInt(match[1] || "0", 10);
  const m = parseInt(match[2] || "0", 10);
  const s = parseInt(match[3] || "0", 10);
  return h * 3600 + m * 60 + s;
}

/* ------------------ Notion ------------------ */

async function getExistingVideoIds() {
  const ids = new Set();
  let cursor = undefined;

  while (true) {
    const res = await fetch(
      `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ start_cursor: cursor })
      }
    );

    const data = await res.json();
    for (const row of data.results) {
      const vid = row.properties["Video ID"]?.rich_text?.[0]?.plain_text;
      if (vid) ids.add(vid);
    }

    if (!data.has_more) break;
    cursor = data.next_cursor;
  }

  return ids;
}

async function insertNotionRow(video) {
  await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      parent: { database_id: NOTION_DATABASE_ID },
      
      icon: {
        type: "emoji",
        emoji: "🎥"
      },

      properties: {
        Name: {
          title: [{ text: { content: video.title } }]
        },
        "Publish Date": {
          date: { start: video.publishedAt }
        },
        Channel: {
          select: { name: video.channel }
        },
        "Video URL": {
          url: `https://www.youtube.com/watch?v=${video.id}`
        },
        "Video ID": {
          rich_text: [{ text: { content: video.id } }]
        },
        Length: {
          number: video.lengthSeconds
        },
        "Imported At": {
          date: { start: new Date().toISOString() }
        }
      }
    })
  });

  await sleep(NOTION_THROTTLE_MS);
}

/* ------------------ YouTube ------------------ */

async function getUploadsPlaylistId(channelId) {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${YOUTUBE_API_KEY}`
  );
  const data = await res.json();
  return data.items[0].contentDetails.relatedPlaylists.uploads;
}

async function getPlaylistItems(playlistId, pageToken) {
  const url =
    `https://www.googleapis.com/youtube/v3/playlistItems` +
    `?part=snippet&maxResults=${PAGE_SIZE}&playlistId=${playlistId}` +
    (pageToken ? `&pageToken=${pageToken}` : "") +
    `&key=${YOUTUBE_API_KEY}`;

  const res = await fetch(url);
  return res.json();
}

async function getDurations(videoIds) {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos` +
      `?part=contentDetails&id=${videoIds.join(",")}&key=${YOUTUBE_API_KEY}`
  );
  const data = await res.json();

  const map = {};
  for (const v of data.items) {
    map[v.id] = parseISODurationToSeconds(v.contentDetails.duration);
  }
  return map;
}

/* ------------------ main ------------------ */

(async () => {
  const existingIds = await getExistingVideoIds();
  let inserted = 0;

  for (const channel of CHANNELS) {
    if (inserted >= MAX_TOTAL_VIDEOS) break;

    const uploadsPlaylist = await getUploadsPlaylistId(channel.id);
    let pageToken = undefined;

    while (inserted < MAX_TOTAL_VIDEOS) {
      const page = await getPlaylistItems(uploadsPlaylist, pageToken);

      const publishedVideos = page.items
        .filter(v => v.snippet.publishedAt && v.snippet.publishedAt < new Date().toISOString())
        .map(v => ({
          id: v.snippet.resourceId.videoId,
          title: v.snippet.title,
          publishedAt: v.snippet.publishedAt,
          channel: channel.name
        }))
        .filter(v => !existingIds.has(v.id));

      if (publishedVideos.length === 0) break;

      const durationMap = await getDurations(publishedVideos.map(v => v.id));

      for (const video of publishedVideos) {
        if (inserted >= MAX_TOTAL_VIDEOS) break;

        await insertNotionRow({
          ...video,
          lengthSeconds: durationMap[video.id] ?? 0
        });

        existingIds.add(video.id);
        inserted++;
      }

      if (!page.nextPageToken) break;
      pageToken = page.nextPageToken;
    }
  }

  console.log(`Inserted ${inserted} videos into Notion.`);
})();
