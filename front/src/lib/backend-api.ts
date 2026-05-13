import { AudioData, ADSBData, VoiceTimestamp } from "@/types";
import type { RecordingMeta } from "@/mock/demo-data";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
export const AUTH_TOKEN_KEY = "alpha.auth.token";

/** 仅保留浏览器可直接请求的地址；否则 WaveSurfer 会把相对路径接到当前站点（如 localhost:3000/temp/...）导致 404 */
export function resolveBrowserAudioUrl(raw: string | undefined | null): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s) || s.startsWith("blob:") || s.startsWith("data:")) return s;
  const base = API_BASE_URL.replace(/\/$/, "");
  if (s.startsWith("/")) return `${base}${s}`;
  return "";
}
export type TableKey =
  | "airports"
  | "users"
  | "tracks"
  | "audio_records"
  | "annotations"
  | "vsp_data"
  | "storage_log";

type BackendUser = {
  user_id: number;
  username: string;
  email?: string | null;
  role?: "admin" | "annotator" | "viewer" | string | null;
};

type LoginResponse = {
  code: number;
  message: string;
  data: {
    token: string;
    token_type: "bearer";
    user_info: BackendUser;
  };
};

function readToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = readToken();
  const headers = new Headers(init?.headers || {});
  const hasBody = init?.body != null && init.body !== "";
  // 无 body 的 GET 不要带 application/json，否则会触发 CORS 预检（OPTIONS）
  if (hasBody && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  const rawText = await response.text();
  const data = rawText ? JSON.parse(rawText) : null;
  if (!response.ok) {
    const msg =
      data?.detail?.message ||
      data?.detail?.[0]?.msg ||
      data?.detail ||
      data?.message ||
      response.statusText ||
      `HTTP ${response.status}`;
    throw new Error(String(msg));
  }
  return data as T;
}

function toUnixSeconds(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const asNum = Number(value);
  if (Number.isFinite(asNum)) return asNum;
  const asDate = Date.parse(String(value ?? ""));
  if (Number.isFinite(asDate)) return asDate / 1000;
  return 0;
}

function toRole(input: unknown): "admin" | "annotator" | "viewer" {
  const normalized = String(input || "viewer").toLowerCase();
  if (normalized === "admin" || normalized === "annotator") return normalized;
  return "viewer";
}

export async function loginWithBackend(username: string, password: string) {
  const payload = { username, password };
  return requestJson<LoginResponse>("/users/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function registerWithBackend(payload: {
  username: string;
  password: string;
  email?: string;
  role?: "annotator" | "viewer";
}) {
  return requestJson<{ code: number; message: string; data: BackendUser }>("/users/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getCurrentUser() {
  return requestJson<{ code: number; message: string; data: BackendUser }>("/users/me");
}

export async function checkPermission(requiredRole: "admin" | "annotator" | "viewer") {
  return requestJson<{
    code: number;
    message: string;
    data: { allowed: boolean; required_role: string; current_role: string };
  }>(`/users/permissions/check/${requiredRole}`);
}

export async function updateUserRole(userId: number, role: "admin" | "annotator" | "viewer") {
  return requestJson<{ code: number; message: string; data: BackendUser }>(`/users/${userId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export async function getPermissionRules() {
  return requestJson<{ code: number; message: string; data: { rules: string[] } }>("/users/permissions/rules");
}

export function normalizeUser(user: BackendUser) {
  const role = toRole(user.role);
  return {
    id: String(user.user_id),
    email: user.email || user.username,
    displayName: user.username,
    role,
  };
}

export function saveToken(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (!token) localStorage.removeItem(AUTH_TOKEN_KEY);
    else localStorage.setItem(AUTH_TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

export async function getHealth() {
  return requestJson<{ ok: true }>("/health");
}

export async function queryArbitrary(payload: { reference: Record<string, unknown>; select: string[] }) {
  return requestJson<Record<string, unknown>[]>("/query/arbitrary", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listTableItems<T>(tableKey: TableKey, limit = 100, offset = 0) {
  return requestJson<T[]>(`/tables/${tableKey}?limit=${limit}&offset=${offset}`);
}

export async function getTableItem<T>(tableKey: TableKey, itemId: string | number) {
  return requestJson<T>(`/tables/${tableKey}/${itemId}`);
}

export async function createTableItem(tableKey: TableKey, values: Record<string, unknown>) {
  return requestJson<{ id: string | number }>(`/tables/${tableKey}`, {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export async function updateTableItem(tableKey: TableKey, itemId: string | number, values: Record<string, unknown>) {
  return requestJson<{ updated: boolean }>(`/tables/${tableKey}/${itemId}`, {
    method: "PUT",
    body: JSON.stringify(values),
  });
}

export async function deleteTableItem(tableKey: TableKey, itemId: string | number) {
  return requestJson<{ deleted: boolean }>(`/tables/${tableKey}/${itemId}`, {
    method: "DELETE",
  });
}

type BackendAudioRecord = {
  audio_id: number;
  source_url?: string;
  duration_ms?: number;
  file_name?: string;
  start_time_utc?: string;
  track_id?: number;
};

type BackendTrack = {
  track_id: number;
  timestamp?: string | number;
  flight_id?: string;
  tracks_latitude?: number;
  tracks_longitude?: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  departure_airport_code?: string;
  arrival_airport_code?: string;
  next_id?: number | string | null;
  prev_id?: number | string | null;
};

/** 与录音关联的 track_id 可能只是一条链上的节点，需把 next_id/prev_id 连通分量一并拉进地图 */
function expandLinkedTracks(allRows: BackendTrack[], seedIds: Set<number>): BackendTrack[] {
  const byId = new Map<number, BackendTrack>();
  for (const t of allRows) {
    const id = Number(t.track_id);
    if (Number.isFinite(id)) byId.set(id, t);
  }
  const out = new Map<number, BackendTrack>();
  const stack = [...seedIds].filter((x) => Number.isFinite(x));
  while (stack.length) {
    const id = stack.pop()!;
    if (!Number.isFinite(id) || out.has(id)) continue;
    const row = byId.get(id);
    if (!row) continue;
    out.set(id, row);
    const nxt = row.next_id != null && row.next_id !== "" ? Number(row.next_id) : NaN;
    const prv = row.prev_id != null && row.prev_id !== "" ? Number(row.prev_id) : NaN;
    if (Number.isFinite(nxt)) stack.push(nxt);
    if (Number.isFinite(prv)) stack.push(prv);
  }
  return [...out.values()];
}

type BackendAnnotation = {
  annotation_id: number;
  audio_id: number;
  relative_start?: number;
  relative_end?: number;
  annotation_text?: string;
  asr_content?: string;
  vad_confidence?: number;
  label_type?: string;
};

export type TracksExtCreatePayload = {
  timestamp: string | number;
  flight_id: string;
  tracks_latitude: number;
  tracks_longitude: number;
  altitude: number;
  speed: number;
  heading: number;
  airport_code: string[];
};

export const tracksExtApi = {
  create: (payload: TracksExtCreatePayload | TracksExtCreatePayload[]) =>
    requestJson<{ id: number; track_id: number | number[] } | Array<{ id: number; track_id: number | number[] }>>(
      "/tables/tracks/ext/create",
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),
  deleteChain: (id: number) =>
    requestJson<{ deleted: true; ids: number[]; count: number }>("/tables/tracks/ext/delete", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  update: (itemId: number, values: Record<string, unknown>) =>
    requestJson<{ updated: true; id: number; chain_ids: number[] }>(`/tables/tracks/ext/update/${itemId}`, {
      method: "POST",
      body: JSON.stringify({ values }),
    }),
  search: (filters: Record<string, unknown>, limit = 100) =>
    requestJson<Array<Record<string, unknown>>>("/tables/tracks/ext/search", {
      method: "POST",
      body: JSON.stringify({ filters, limit }),
    }),
};

export type AudioExtCreatePayload = Record<string, unknown> & { track_id: number };

export const audioRecordsExtApi = {
  create: (payload: AudioExtCreatePayload | AudioExtCreatePayload[]) =>
    requestJson<
      | { id: number; audio_id: number | number[] }
      | Array<{
          id: number;
          audio_id: number | number[];
        }>
    >("/tables/audio_records/ext/create", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  deleteChain: (id: number) =>
    requestJson<{ deleted: true; ids: number[]; count: number }>("/tables/audio_records/ext/delete-chain", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  deleteOne: (id: number) =>
    requestJson<{ deleted: true; id: number; prev_id?: number | null; next_id?: number | null; relinked: boolean }>(
      "/tables/audio_records/ext/delete-one",
      {
        method: "POST",
        body: JSON.stringify({ id }),
      }
    ),
  searchAll: (filters: Record<string, unknown>, limit = 100) =>
    requestJson<Array<Record<string, unknown>> | Array<Array<Record<string, unknown>>>>(
      "/tables/audio_records/ext/search-all",
      {
        method: "POST",
        body: JSON.stringify({ filters, limit }),
      }
    ),
  searchOne: (filters: Record<string, unknown>, limit = 100) =>
    requestJson<Array<Record<string, unknown>>>("/tables/audio_records/ext/search-one", {
      method: "POST",
      body: JSON.stringify({ filters, limit }),
    }),
  update: (itemId: number, values: Record<string, unknown>) =>
    requestJson<{ updated: true; id: number }>(`/tables/audio_records/ext/update/${itemId}`, {
      method: "POST",
      body: JSON.stringify({ values }),
    }),
};

export type AnnotationsExtCreatePayload = Record<string, unknown> & { audio_id: number };

export const annotationsExtApi = {
  create: (payload: AnnotationsExtCreatePayload | AnnotationsExtCreatePayload[]) =>
    requestJson<{ id: number; annotation_id: number | number[] } | Array<{ id: number; annotation_id: number | number[] }>>(
      "/tables/annotations/ext/create",
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    ),
  deleteChain: (id: number) =>
    requestJson<{ deleted: true; ids: number[]; count: number }>("/tables/annotations/ext/delete-chain", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  deleteOne: (id: number) =>
    requestJson<{ deleted: true; id: number; prev_id?: number | null; next_id?: number | null; relinked: boolean }>(
      "/tables/annotations/ext/delete-one",
      {
        method: "POST",
        body: JSON.stringify({ id }),
      }
    ),
  searchAll: (filters: Record<string, unknown>, limit = 100) =>
    requestJson<Array<Record<string, unknown>> | Array<Array<Record<string, unknown>>>>(
      "/tables/annotations/ext/search-all",
      {
        method: "POST",
        body: JSON.stringify({ filters, limit }),
      }
    ),
  searchOne: (filters: Record<string, unknown>, limit = 100) =>
    requestJson<Array<Record<string, unknown>>>("/tables/annotations/ext/search-one", {
      method: "POST",
      body: JSON.stringify({ filters, limit }),
    }),
  update: (itemId: number, values: Record<string, unknown>) =>
    requestJson<{ updated: true; id: number }>(`/tables/annotations/ext/update/${itemId}`, {
      method: "POST",
      body: JSON.stringify({ values }),
    }),
};

export async function fetchAnnotationBundle(): Promise<{
  recordings: AudioData[];
  adsbData: ADSBData[];
  recordingMeta: Record<string, RecordingMeta>;
}> {
  // 与后端 GET /tables/{key}?limit= 上限（当前 le=1000）一致，避免 422
  const [audioRows, trackRows, annotationRows] = await Promise.all([
    listTableItems<BackendAudioRecord>("audio_records", 1000, 0),
    listTableItems<BackendTrack>("tracks", 1000, 0),
    listTableItems<BackendAnnotation>("annotations", 1000, 0),
  ]);

  const tracksById = new Map<number, BackendTrack>();
  for (const t of trackRows) tracksById.set(Number(t.track_id), t);

  const annotationsByAudioId = new Map<number, VoiceTimestamp[]>();
  for (const a of annotationRows) {
    const audioId = Number(a.audio_id);
    const start = Number.isFinite(Number(a.relative_start)) ? Number(a.relative_start) : 0;
    const endCandidate = Number(a.relative_end);
    const end = Number.isFinite(endCandidate) ? endCandidate : Math.max(start + 1, start);
    const ts: VoiceTimestamp = {
      id: String(a.annotation_id),
      startTime: start,
      endTime: Math.max(start, end),
      text: a.annotation_text || a.asr_content || "",
      confidence: Number.isFinite(Number(a.vad_confidence)) ? Number(a.vad_confidence) : undefined,
      speaker: a.label_type || undefined,
    };
    const list = annotationsByAudioId.get(audioId) || [];
    list.push(ts);
    annotationsByAudioId.set(audioId, list);
  }
  for (const list of annotationsByAudioId.values()) {
    list.sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
  }

  const recordings: AudioData[] = audioRows.map((row) => {
    const id = String(row.audio_id);
    const track = tracksById.get(Number(row.track_id));
    return {
      id,
      url: resolveBrowserAudioUrl(row.source_url),
      duration: Math.max(1, Math.round((Number(row.duration_ms) || 0) / 1000)),
      timestamps: annotationsByAudioId.get(Number(row.audio_id)) || [],
      metadata: {
        icao: track?.departure_airport_code || track?.arrival_airport_code || track?.flight_id,
        date: row.start_time_utc ? String(row.start_time_utc).slice(0, 10) : undefined,
      },
    };
  });

  const relatedTrackIds = new Set(audioRows.map((r) => Number(r.track_id)).filter((x) => Number.isFinite(x)));
  const usableTracks =
    relatedTrackIds.size > 0 ? expandLinkedTracks(trackRows, relatedTrackIds) : trackRows;

  const parsedTimes = usableTracks
    .map((t) => toUnixSeconds(t.timestamp))
    .filter((x) => Number.isFinite(x));
  const baseTime = parsedTimes.length ? Math.min(...parsedTimes) : 0;

  const adsbData: ADSBData[] = usableTracks
    .filter((t) => Number.isFinite(Number(t.tracks_latitude)) && Number.isFinite(Number(t.tracks_longitude)))
    .map((t) => {
      const rawTs = toUnixSeconds(t.timestamp);
      const relTs = rawTs > 1000000000 ? rawTs - baseTime : rawTs;
      const flight = t.flight_id || `track-${t.track_id}`;
      return {
        id: String(t.track_id),
        timestamp: Math.max(0, relTs),
        icao24: String(flight).toLowerCase(),
        callsign: flight,
        latitude: Number(t.tracks_latitude),
        longitude: Number(t.tracks_longitude),
        altitude: Number(t.altitude) || 0,
        speed: Number(t.speed) || 0,
        heading: Number(t.heading) || 0,
      };
    });

  const recordingMeta: Record<string, RecordingMeta> = {};
  for (const row of audioRows) {
    const id = String(row.audio_id);
    const fileName = String(row.file_name || "").toLowerCase();
    recordingMeta[id] = {
      channel: fileName.includes("cabin") ? "Cabin" : "Radio",
      mine: false,
    };
  }

  return { recordings, adsbData, recordingMeta };
}

