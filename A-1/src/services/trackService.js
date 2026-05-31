const { randomUUID } = require("crypto");
const { db } = require("../db");

const adsbTrackColumns = new Set(
  db
    .prepare("PRAGMA table_info(adsb_tracks)")
    .all()
    .map((column) => column.name),
);

function parseNumber(value, field, integer = false, nullable = true) {
  if (value === undefined || value === null || value === "") {
    if (nullable) {
      return null;
    }

    throw new Error(`${field} is required.`);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be a valid number.`);
  }

  return integer ? Math.trunc(parsed) : parsed;
}

function normalizeLocation(input) {
  if (
    input.location !== undefined &&
    input.location !== null &&
    input.location !== ""
  ) {
    return String(input.location);
  }

  // Accept frontend-friendly latitude/longitude fields and store them as POINT(lng lat).
  const latitude = parseNumber(
    input.latitude ?? input.lat,
    "latitude",
    false,
    false,
  );
  const longitude = parseNumber(
    input.longitude ?? input.lng,
    "longitude",
    false,
    false,
  );
  return `POINT(${longitude} ${latitude})`;
}

function normalizeCoordinates(input) {
  if (input.location !== undefined && input.location !== null && input.location !== "") {
    const pointMatch = String(input.location).match(
      /^POINT\s*\(\s*([-+]?\d+(?:\.\d+)?)\s+([-+]?\d+(?:\.\d+)?)\s*\)$/i,
    );
    if (pointMatch) {
      const longitude = parseNumber(pointMatch[1], "longitude", false, false);
      const latitude = parseNumber(pointMatch[2], "latitude", false, false);
      return { latitude, longitude, location: `POINT(${longitude} ${latitude})` };
    }
  }

  const latitude = parseNumber(input.latitude ?? input.lat, "latitude", false, false);
  const longitude = parseNumber(
    input.longitude ?? input.lng ?? input.lon,
    "longitude",
    false,
    false,
  );
  return { latitude, longitude, location: `POINT(${longitude} ${latitude})` };
}

function normalizeCallsign(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function normalizeRawPayload(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function findDuplicateTrackId(track) {
  if (!track.callsign || track.latitude === undefined || track.longitude === undefined) {
    return null;
  }

  if (adsbTrackColumns.has("latitude") && adsbTrackColumns.has("longitude")) {
    const row = db
      .prepare(
        `
        SELECT track_id
        FROM adsb_tracks
        WHERE callsign = @callsign
          AND latitude = @latitude
          AND longitude = @longitude
        ORDER BY timestamp DESC
        LIMIT 1
      `,
      )
      .get({
        callsign: track.callsign,
        latitude: track.latitude,
        longitude: track.longitude,
      });

    return row?.track_id ?? null;
  }

  if (!adsbTrackColumns.has("location")) {
    return null;
  }

  const row = db
    .prepare(
      `
      SELECT track_id
      FROM adsb_tracks
      WHERE callsign = @callsign
        AND location = @location
      ORDER BY timestamp DESC
      LIMIT 1
    `,
    )
    .get({
      callsign: track.callsign,
      location: track.location,
    });

  return row?.track_id ?? null;
}

function normalizeTrack(input, fallbackSource) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Track payload must be an object.");
  }

  const coordinates = normalizeCoordinates(input);
  const track = {
    track_id: input.track_id || randomUUID(),
    callsign: normalizeCallsign(input.callsign ?? input.flight ?? input.flight_number),
    location: normalizeLocation(input),
    altitude: parseNumber(input.altitude ?? input.altitude_ft, "altitude", false, true),
    ground_speed: parseNumber(
      input.ground_speed ?? input.ground_speed_kt ?? input.speed,
      "ground_speed",
      false,
      true,
    ),
    heading: parseNumber(input.heading ?? input.track, "heading", false, true),
    timestamp: input.timestamp || new Date().toISOString(),
  };

  if (adsbTrackColumns.has("location")) {
    track.location = coordinates.location;
  }

  if (adsbTrackColumns.has("latitude")) {
    track.latitude = coordinates.latitude;
  }

  if (adsbTrackColumns.has("longitude")) {
    track.longitude = coordinates.longitude;
  }

  if (adsbTrackColumns.has("source")) {
    track.source = input.source || fallbackSource || null;
  }

  if (adsbTrackColumns.has("raw_payload")) {
    track.raw_payload = normalizeRawPayload(
      input.raw_payload ?? input.rawPayload,
    );
  }

  const duplicateTrackId = findDuplicateTrackId(track);
  if (duplicateTrackId) {
    track.track_id = duplicateTrackId;
  }

  return track;
}

const upsertColumns = [
  "track_id",
  "callsign",
  "location",
  "latitude",
  "longitude",
  "altitude",
  "ground_speed",
  "heading",
  "timestamp",
  "source",
  "raw_payload",
].filter((column) => adsbTrackColumns.has(column));

const upsertAssignments = upsertColumns
  .filter((column) => column !== "track_id")
  .map((column) => `${column} = excluded.${column}`)
  .join(",\n    ");

const upsertTrackStatement = db.prepare(`
  INSERT INTO adsb_tracks (
    ${upsertColumns.join(",\n    ")}
  ) VALUES (
    ${upsertColumns.map((column) => `@${column}`).join(",\n    ")}
  )
  ON CONFLICT(track_id) DO UPDATE SET
    ${upsertAssignments}
`);

const batchUpsertTransaction = db.transaction((items, fallbackSource) =>
  items.map((item) => {
    const track = normalizeTrack(item, fallbackSource);
    upsertTrackStatement.run(track);
    return track;
  }),
);

function upsertTrack(item, fallbackSource) {
  const track = normalizeTrack(item, fallbackSource);
  upsertTrackStatement.run(track);
  return track;
}

function batchUpsertTracks(items, fallbackSource) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error("items must be a non-empty array.");
  }

  return batchUpsertTransaction(items, fallbackSource);
}

module.exports = {
  normalizeTrack,
  upsertTrack,
  batchUpsertTracks,
};
