const LRCLIB_BASE = "https://lrclib.net/api";

async function fetchSyncedLyrics({ track, artist, album, duration }) {
  if (!track || !artist) return null;

  const getParams = new URLSearchParams({ track_name: track, artist_name: artist });
  if (album) getParams.set("album_name", album);
  if (duration) getParams.set("duration", String(Math.round(duration)));

  const directRes = await fetch(`${LRCLIB_BASE}/get?${getParams.toString()}`);
  if (directRes.ok) {
    const data = await directRes.json();
    if (data.syncedLyrics) {
      return { syncedLyrics: data.syncedLyrics, plainLyrics: data.plainLyrics ?? null };
    }
  }

  // No exact match (e.g. slightly different album title or duration) — fall back to fuzzy search.
  const searchParams = new URLSearchParams({ track_name: track, artist_name: artist });
  const searchRes = await fetch(`${LRCLIB_BASE}/search?${searchParams.toString()}`);
  if (!searchRes.ok) return null;

  const results = await searchRes.json();
  const withSync = Array.isArray(results) ? results.find(r => r.syncedLyrics) : null;
  if (!withSync) return null;

  return { syncedLyrics: withSync.syncedLyrics, plainLyrics: withSync.plainLyrics ?? null };
}

module.exports = { fetchSyncedLyrics };
