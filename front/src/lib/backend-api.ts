import { dedupeAdsbPointsByFlight, enrichVerticalRates } from "@/lib/adsb-interpolation";
import { stripSyntheticDetour } from "@/lib/detour-aircraft";
import { AudioData, ADSBData, VoiceTimestamp } from "@/types";
import {
  formatRecordingCaptureTimeLocal,
  formatRecordingFileName,
  parseRecordingUtcRangeFromFileName,
} from "@/lib/recording-display";
import {
  buildAdsbAlignedToRecording,
  buildAdsbFromLiveWallClockBuffer,
  finalizeRecordingAdsb,
  toUnixSeconds,
  type MapTrackRow,
} from "@/lib/recording-adsb-alignment";
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

/** 标注相对时间（秒）；过滤误写入的 Unix 时间戳或毫秒 */
export function normalizeRelativeSeconds(raw: unknown, durationSec: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 1e9) return 0;
  if (n > 86_400 && n < 1e9) return Math.min(n / 1000, Math.max(durationSec, 60));
  if (durationSec > 0 && n > durationSec * 20) return Math.min(n / 1000, durationSec);
  return n;
}

const VHHH_CENTER = { lat: 22.308, lon: 113.918 };
const DEMO_FLIGHT_IDS = new Set(["VHHH-DEMO-CPA123", "A1-DEMO-001"]);

function isNearVhhh(lat: unknown, lon: unknown, delta = 2.5): boolean {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return false;
  return Math.abs(la - VHHH_CENTER.lat) <= delta && Math.abs(lo - VHHH_CENTER.lon) <= delta;
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

export async function listTableItems<T>(tableKey: TableKey, limit = 100, offset = 0, noCache = false) {
  const bust = noCache ? `&_=${Date.now()}` : "";
  return requestJson<T[]>(`/tables/${tableKey}?limit=${limit}&offset=${offset}${bust}`);
}

/** 分页拉全表（annotations 超过 1000 时，新转写不会出现在首页列表里） */
export async function listAllTableItems<T>(
  tableKey: TableKey,
  pageSize = 1000,
  noCache = false
): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const chunk = await listTableItems<T>(tableKey, pageSize, offset, noCache);
    all.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return all;
}

export type RefreshRecordingsResult = {
  ok: number;
  synced?: number;
  updated?: number;
  skipped?: number;
  blocked?: number;
  a2_total?: number;
  a5_total?: number;
  pending_audio_ids?: number[];
  unblock?: { removed?: number; remaining?: number };
  error?: string;
  a2_trigger?: Record<string, unknown>;
  via?: string;
};

/** 联调：触发 A2 下载 + 同步 A5（优先 A5，失败则走 Next 本地脚本） */
/** 对无转写的录音跑 A3/Whisper ASR（写入 A5 annotations） */
export async function triggerAsrForRecording(
  audioId: string,
  options?: { limit?: number }
): Promise<{ ok?: number; annotations?: number; error?: string; details?: unknown[] }> {
  const params = new URLSearchParams();
  params.set("audio_id", audioId);
  if (options?.limit != null) params.set("limit", String(options.limit));

  const parseAsrResponse = async (response: Response) => {
    const rawText = await response.text();
    const data = rawText ? JSON.parse(rawText) : null;
    if (!response.ok) {
      const detailErr =
        Array.isArray(data?.details) && data.details[0] && typeof data.details[0] === "object"
          ? String((data.details[0] as { error?: string }).error || "")
          : "";
      const msg =
        data?.detail?.message ||
        data?.detail ||
        detailErr ||
        data?.error ||
        data?.message ||
        response.statusText ||
        `HTTP ${response.status}`;
      throw new Error(String(msg));
    }
    return data as { ok?: number; annotations?: number; error?: string; details?: unknown[] };
  };

  const token = readToken();
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);

  try {
    const response = await fetch(`${API_BASE_URL}/sync/a3-asr?${params}`, {
      method: "POST",
      headers,
      body: "{}",
      signal: AbortSignal.timeout(600_000),
    });
    if (response.status === 404) {
      throw new Error("A5_SYNC_ASR_NOT_FOUND");
    }
    return await parseAsrResponse(response);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg !== "A5_SYNC_ASR_NOT_FOUND" && !msg.includes("404") && !msg.toLowerCase().includes("not found")) {
      throw error;
    }
    // A5 未重启、无 /sync/a3-asr 时走 Next 本机脚本（与 refresh-recordings 相同）
    const fallback = await fetch(`/api/a3-asr?${params}`, {
      method: "POST",
      signal: AbortSignal.timeout(600_000),
    });
    return await parseAsrResponse(fallback);
  }
}

/** 拉取 A5 中 OpenSky 实时航迹全路径（按航班时间序，供完整尾迹） */
export async function fetchLiveTracksFromApi(
  hours = 4,
  limit = 30_000
): Promise<BackendTrack[]> {
  try {
    const bust = `&_=${Date.now()}`;
    return await requestJson<BackendTrack[]>(
      `/tracks/live?hours=${hours}&limit=${limit}${bust}`
    );
  } catch {
    return [];
  }
}

/** 地图轮询专用：只拉实时航迹，避免每 10s 重载三表 */
export async function fetchLiveAdsbForMap(
  hours = 6,
  limit = 50_000
): Promise<{
  adsbData: ADSBData[];
  liveAircraftCount: number;
  /** 实时库中最新点时间（Unix 秒），用于判断是否在增长 */
  latestLiveAt: number | null;
  activeWithinMinutes: number;
}> {
  const liveTrackRows = await fetchLiveTracksFromApi(hours, limit);
  const liveAdsb = buildLiveAdsbPoints(liveTrackRows, {
    activeWithinMinutes: 360,
    trailWithinMinutes: Math.max(LIVE_TRAIL_MINUTES, 360),
  });
  let latestLiveAt: number | null = null;
  for (const t of liveTrackRows) {
    const ts = toUnixSeconds(t.timestamp);
    if (ts > 1_000_000_000 && (latestLiveAt == null || ts > latestLiveAt)) {
      latestLiveAt = ts;
    }
  }
  const merged = stripSyntheticDetour(liveAdsb);
  return {
    adsbData: merged,
    liveAircraftCount: new Set(merged.filter((p) => p.live).map((p) => p.icao24)).size,
    latestLiveAt,
    activeWithinMinutes: LIVE_ACTIVE_MINUTES,
  };
}

/** 触发一轮 OpenSky 采集并同步 A5（需 A5 已重启含 /sync/a1-live-once） */
export async function triggerA1LiveCollectOnce(): Promise<Record<string, unknown>> {
  const token = readToken();
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE_URL}/sync/a1-live-once`, {
    method: "POST",
    headers,
    body: "{}",
    signal: AbortSignal.timeout(90_000),
  });
  const rawText = await response.text();
  const data = rawText ? JSON.parse(rawText) : null;
  if (!response.ok) {
    const msg =
      data?.detail?.message ||
      data?.detail ||
      data?.message ||
      response.statusText ||
      `HTTP ${response.status}`;
    throw new Error(String(msg));
  }
  return data as Record<string, unknown>;
}

/** 地图「在线」口径：该时间内仍有 ADS-B 回波的航班（非 4 小时历史累计） */
const LIVE_ACTIVE_MINUTES = 25;
/** 单架飞机尾迹最多展示最近多少分钟 */
const LIVE_TRAIL_MINUTES = 120;

function buildLiveAdsbPoints(
  liveRows: BackendTrack[],
  opts?: { activeWithinMinutes?: number; trailWithinMinutes?: number }
): ADSBData[] {
  const activeMin = opts?.activeWithinMinutes ?? LIVE_ACTIVE_MINUTES;
  const trailMin = opts?.trailWithinMinutes ?? LIVE_TRAIL_MINUTES;
  const nowSec = Date.now() / 1000;
  const activeCutoff = nowSec - activeMin * 60;
  const trailCutoff = nowSec - trailMin * 60;

  const byFlight = new Map<string, BackendTrack[]>();
  for (const t of liveRows) {
    const fid = String(t.flight_id || "").trim() || `track-${t.track_id}`;
    const list = byFlight.get(fid) ?? [];
    list.push(t);
    byFlight.set(fid, list);
  }

  const out: ADSBData[] = [];
  for (const [flightId, rows] of byFlight.entries()) {
    const sorted = [...rows].sort(
      (a, b) =>
        toUnixSeconds(a.timestamp) - toUnixSeconds(b.timestamp) ||
        Number(a.track_id) - Number(b.track_id)
    );
    const lastTs = toUnixSeconds(sorted[sorted.length - 1].timestamp);
    if (lastTs < activeCutoff) continue;

    const trailRows = sorted.filter((t) => toUnixSeconds(t.timestamp) >= trailCutoff);
    const toRender = trailRows.length > 0 ? trailRows : sorted.slice(-1);

    toRender.forEach((t, idx) => {
      const icao = flightId.toLowerCase();
      const ts = toUnixSeconds(t.timestamp);
      const verticalRate =
        t.vertical_rate != null && Number.isFinite(Number(t.vertical_rate))
          ? Number(t.vertical_rate)
          : undefined;

      out.push({
        id: String(t.track_id),
        timestamp: ts > 1_000_000_000 ? ts : idx,
        icao24: icao,
        callsign: flightId,
        latitude: Number(t.tracks_latitude),
        longitude: Number(t.tracks_longitude),
        altitude: Number(t.altitude) || 0,
        speed: Number(t.speed) || 0,
        heading: Number(t.heading) || 0,
        verticalRate,
        live: true,
      });
    });
  }
  return enrichVerticalRates(
    dedupeAdsbPointsByFlight(out, { minMoveMeters: 120, maxPointsPerFlight: 160 })
  );
}

export async function refreshRecordingsFromA2(options?: {
  full?: boolean;
  /** false = 仅同步 A5，不触发 A2 下载 */
  download?: boolean;
  /** 0 = 不在同步阶段批量 ASR（由前端逐条 /sync/a3-asr） */
  a3Limit?: number;
}): Promise<RefreshRecordingsResult> {
  const params = new URLSearchParams();
  if (options?.full) params.set("full", "true");
  if (options?.download === false) params.set("download", "false");
  if (options?.a3Limit != null) params.set("a3_limit", String(options.a3Limit));
  const q = params.toString() ? `?${params}` : "";
  try {
    return await requestJson<RefreshRecordingsResult>(`/sync/a2-to-a5${q}`, {
      method: "POST",
      body: "{}",
    });
  } catch {
    const fallback = new URLSearchParams();
    if (options?.full) fallback.set("full", "1");
    if (options?.download === false) fallback.set("sync_only", "1");
    if (options?.a3Limit === 0) fallback.set("no_a3", "1");
    const res = await fetch(`/api/refresh-recordings${fallback.toString() ? `?${fallback}` : ""}`, {
      method: "POST",
    });
    const data = (await res.json()) as RefreshRecordingsResult;
    if (!res.ok) throw new Error(String(data.error || `refresh failed ${res.status}`));
    return data;
  }
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
  end_time_utc?: string;
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
  /** 爬升率 ft/min（OpenSky 或推算） */
  vertical_rate?: number;
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

/** 地图航迹：链表扩展 + 同 flight_id 全点 + VHHH 录音优先香港附近航路 */
function expandTracksForMap(
  allRows: BackendTrack[],
  seedIds: Set<number>,
  options?: { preferVhhh?: boolean }
): BackendTrack[] {
  const linked = expandLinkedTracks(allRows, seedIds);
  const out = new Map<number, BackendTrack>();
  for (const t of linked) {
    const id = Number(t.track_id);
    if (Number.isFinite(id)) out.set(id, t);
  }

  const flightIds = new Set(
    linked.map((t) => String(t.flight_id || "").trim()).filter(Boolean)
  );
  for (const row of allRows) {
    const fid = String(row.flight_id || "").trim();
    if (!fid || !flightIds.has(fid)) continue;
    const id = Number(row.track_id);
    if (Number.isFinite(id)) out.set(id, row);
  }

  let rows = [...out.values()];
  if (options?.preferVhhh) {
    const hk = rows.filter((t) => isNearVhhh(t.tracks_latitude, t.tracks_longitude));
    if (hk.length >= 2) rows = hk;
  }
  return rows;
}

/** 按 track_id 从 API 拉整条 next/prev 链（不受 list limit=1000 分页影响） */
async function fetchLinkedTrackChainFromApi(seedId: number): Promise<BackendTrack[]> {
  const byId = new Map<number, BackendTrack>();
  const stack = [seedId];

  while (stack.length) {
    const id = stack.pop()!;
    if (!Number.isFinite(id) || byId.has(id)) continue;
    try {
      const row = await getTableItem<BackendTrack>("tracks", id);
      if (!row?.track_id) continue;
      const trackId = Number(row.track_id);
      byId.set(trackId, row);
      const nxt = row.next_id != null && row.next_id !== "" ? Number(row.next_id) : NaN;
      const prv = row.prev_id != null && row.prev_id !== "" ? Number(row.prev_id) : NaN;
      if (Number.isFinite(nxt)) stack.push(nxt);
      if (Number.isFinite(prv)) stack.push(prv);
    } catch {
      // 单点缺失不影响其余链
    }
  }
  return [...byId.values()];
}

async function fetchTracksForMapSeeds(seedIds: Iterable<number>): Promise<BackendTrack[]> {
  const unique = [...new Set([...seedIds].filter((x) => Number.isFinite(x) && x > 0))];
  if (!unique.length) return [];
  const chains = await Promise.all(unique.map((id) => fetchLinkedTrackChainFromApi(id)));
  const out = new Map<number, BackendTrack>();
  for (const row of chains.flat()) {
    const id = Number(row.track_id);
    if (Number.isFinite(id)) out.set(id, row);
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

/** 仅在 A5 尚无 start_time_utc 时写入；优先从文件名解析，避免覆盖历史采集时刻 */
export async function ensureRecordingCaptureUtc(
  audioId: string,
  durationSec: number,
  fileName?: string
) {
  const id = Number(audioId);
  if (!Number.isFinite(id) || id <= 0) return;
  let row: BackendAudioRecord;
  try {
    row = await getTableItem<BackendAudioRecord>("audio_records", audioId);
  } catch {
    return;
  }
  if (row.start_time_utc) return;

  const duration = Math.max(1, durationSec);
  const fromFile = fileName ? parseRecordingUtcRangeFromFileName(fileName, duration) : null;
  if (fromFile) {
    await audioRecordsExtApi.update(id, {
      start_time_utc: fromFile.startTimeUtc,
      end_time_utc: fromFile.endTimeUtc,
    });
    return;
  }

  const durMs = Math.max(1000, Math.round(duration * 1000));
  const end = new Date();
  const start = new Date(end.getTime() - durMs);
  const toIso = (d: Date) => d.toISOString();
  await audioRecordsExtApi.update(id, {
    start_time_utc: toIso(start),
    end_time_utc: toIso(end),
  });
}

/** 删除 A5 一条录音（含关联标注，不可恢复） */
export async function deleteRecordingFromBackend(audioId: string) {
  const id = Number(audioId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("仅可删除已同步到后端的录音（数字 ID）");
  }
  return audioRecordsExtApi.deleteOne(id);
}

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

/** 按 audio_id 从 A5 拉单条录音（含无转写项） */
export async function fetchRecordingByAudioId(
  audioId: string,
  noCache = true
): Promise<AudioData | null> {
  try {
    const row = await getTableItem<BackendAudioRecord>("audio_records", audioId);
    const id = String(row.audio_id);
    const fileName = String(row.file_name || "").trim();
    const startTimeUtc = row.start_time_utc ? String(row.start_time_utc) : undefined;
    const endTimeUtc = row.end_time_utc ? String(row.end_time_utc) : undefined;
    const trackIdNum = Number(row.track_id);
    const durationSec = Math.max(1, Math.round((Number(row.duration_ms) || 0) / 1000));
    return {
      id,
      url: resolveBrowserAudioUrl(row.source_url),
      duration: durationSec,
      timestamps: [],
      metadata: {
        title:
          formatRecordingCaptureTimeLocal(startTimeUtc) ||
          formatRecordingFileName(fileName) ||
          undefined,
        fileName: fileName || undefined,
        startTimeUtc,
        endTimeUtc,
        trackId: Number.isFinite(trackIdNum) && trackIdNum > 0 ? trackIdNum : undefined,
      },
    };
  } catch {
    return null;
  }
}

/** A5 中已同步但尚无 LNG_ANNOTATIONS 的录音（供「实时更新」挑选 ASR 目标） */
export async function fetchPendingRecordingsForAsr(noCache = true): Promise<AudioData[]> {
  const [audioRows, annotationRows] = await Promise.all([
    listTableItems<BackendAudioRecord>("audio_records", 1000, 0, noCache),
    listAllTableItems<BackendAnnotation>("annotations", 1000, noCache),
  ]);
  const withAnn = new Set<number>();
  for (const a of annotationRows) {
    const id = Number(a.audio_id);
    if (Number.isFinite(id)) withAnn.add(id);
  }
  return audioRows
    .filter((row) => !withAnn.has(Number(row.audio_id)))
    .map((row) => {
      const id = String(row.audio_id);
      const fileName = String(row.file_name || "").trim();
      const startTimeUtc = row.start_time_utc ? String(row.start_time_utc) : undefined;
      const durationSec = Math.max(1, Math.round((Number(row.duration_ms) || 0) / 1000));
      return {
        id,
        url: resolveBrowserAudioUrl(row.source_url),
        duration: durationSec,
        timestamps: [],
        metadata: {
          title:
            formatRecordingCaptureTimeLocal(startTimeUtc) ||
            formatRecordingFileName(fileName) ||
            undefined,
          fileName: fileName || undefined,
          startTimeUtc,
        },
      };
    });
}

export type AnnotationBundle = {
  recordings: AudioData[];
  /** 无录音时间窗时的回退（多为 OpenSky 实时层） */
  adsbData: ADSBData[];
  /** 按 audio_id：UTC 窗口内航迹，timestamp 已对齐播放条 0…duration */
  adsbByRecordingId: Record<string, ADSBData[]>;
  recordingMeta: Record<string, RecordingMeta>;
  liveAircraftCount: number;
};

function buildAudioMetadataFromRow(
  row: BackendAudioRecord,
  track: BackendTrack | undefined,
  durationSec: number
): NonNullable<AudioData["metadata"]> {
  const fileName = String(row.file_name || "").trim();
  const startTimeUtc = row.start_time_utc ? String(row.start_time_utc) : undefined;
  const endTimeUtc = row.end_time_utc ? String(row.end_time_utc) : undefined;
  const trackIdNum = Number(row.track_id);
  const flight = track?.flight_id ? String(track.flight_id).trim() : undefined;
  const linkTrackMeta = Number.isFinite(trackIdNum) && trackIdNum > 1;
  const title =
    formatRecordingFileName(fileName) || formatRecordingCaptureTimeLocal(startTimeUtc) || undefined;
  return {
    title,
    fileName: fileName || undefined,
    startTimeUtc,
    endTimeUtc,
    trackId: Number.isFinite(trackIdNum) && trackIdNum > 0 ? trackIdNum : undefined,
    primaryCallsign: linkTrackMeta && flight ? flight : undefined,
    icao: linkTrackMeta && flight ? flight : undefined,
    date: startTimeUtc ? String(startTimeUtc).slice(0, 10) : undefined,
  };
}

export async function fetchAnnotationBundle(options?: {
  noCache?: boolean;
  /** 地图用：有实时数据时不回退 VHHH-DEMO 演示航迹 */
  mapLiveOnly?: boolean;
}): Promise<AnnotationBundle> {
  const noCache = options?.noCache ?? false;
  const mapLiveOnly = options?.mapLiveOnly ?? false;
  // 与后端 GET /tables/{key}?limit= 上限（当前 le=1000）一致，避免 422
  const [audioRows, trackRows, annotationRows] = await Promise.all([
    listTableItems<BackendAudioRecord>("audio_records", 1000, 0, noCache),
    listTableItems<BackendTrack>("tracks", 1000, 0, noCache),
    listAllTableItems<BackendAnnotation>("annotations", 1000, noCache),
  ]);

  const tracksById = new Map<number, BackendTrack>();
  for (const t of trackRows) tracksById.set(Number(t.track_id), t);

  const relatedTrackIds = new Set(audioRows.map((r) => Number(r.track_id)).filter((x) => Number.isFinite(x)));
  const chainTracks = await fetchTracksForMapSeeds(relatedTrackIds);
  for (const t of chainTracks) tracksById.set(Number(t.track_id), t);

  const preferVhhh = audioRows.some((r) =>
    String(r.file_name || r.source_url || "").toLowerCase().includes("vhhh")
  );
  const mergedTrackRows = [...tracksById.values()];
  const liveTrackRows = await fetchLiveTracksFromApi(1, 30_000);
  const liveAdsb = buildLiveAdsbPoints(liveTrackRows, {
    activeWithinMinutes: Math.max(LIVE_ACTIVE_MINUTES, 360),
    trailWithinMinutes: Math.max(LIVE_TRAIL_MINUTES, 360),
  });

  let usableTracks =
    relatedTrackIds.size > 0
      ? expandTracksForMap(mergedTrackRows, relatedTrackIds, { preferVhhh })
      : mergedTrackRows.filter((t) => isNearVhhh(t.tracks_latitude, t.tracks_longitude));

  const annotationsByAudioId = new Map<number, VoiceTimestamp[]>();
  const durationByAudioId = new Map<number, number>();
  for (const row of audioRows) {
    durationByAudioId.set(
      Number(row.audio_id),
      Math.max(1, Math.round((Number(row.duration_ms) || 0) / 1000))
    );
  }

  for (const a of annotationRows) {
    const audioId = Number(a.audio_id);
    const durationSec = durationByAudioId.get(audioId) ?? 60;
    const start = normalizeRelativeSeconds(a.relative_start, durationSec);
    const endCandidate = normalizeRelativeSeconds(a.relative_end, durationSec);
    const end = Number.isFinite(endCandidate) && endCandidate > start ? endCandidate : Math.max(start + 1, start);
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

  const nowSec = Date.now() / 1000;
  const hasRecentAudio = audioRows.some((row) => {
    const st = toUnixSeconds(row.start_time_utc);
    return st > 1_000_000_000 && nowSec - st < 6 * 3600;
  });
  if (hasRecentAudio) {
    for (const t of await fetchLiveTracksFromApi(2, 50_000)) {
      const id = Number(t.track_id);
      if (Number.isFinite(id)) tracksById.set(id, t);
    }
  }
  const allTracksForAlignment: MapTrackRow[] = [...tracksById.values()];

  const recordings: AudioData[] = audioRows
    .filter((row) => (annotationsByAudioId.get(Number(row.audio_id))?.length ?? 0) > 0)
    .map((row) => {
      const id = String(row.audio_id);
      const track = tracksById.get(Number(row.track_id));
      const durationSec = Math.max(1, Math.round((Number(row.duration_ms) || 0) / 1000));
      return {
        id,
        url: resolveBrowserAudioUrl(row.source_url),
        duration: durationSec,
        timestamps: (annotationsByAudioId.get(Number(row.audio_id)) || []).map((ts) => ({
          ...ts,
          startTime: normalizeRelativeSeconds(ts.startTime, durationSec),
          endTime: normalizeRelativeSeconds(ts.endTime, durationSec),
        })),
        metadata: buildAudioMetadataFromRow(row, track, durationSec),
      };
    });

  const adsbByRecordingId: Record<string, ADSBData[]> = {};
  for (const row of audioRows) {
    const id = String(row.audio_id);
    const track = tracksById.get(Number(row.track_id));
    const durationSec = Math.max(1, Math.round((Number(row.duration_ms) || 0) / 1000));
    const stub: AudioData = {
      id,
      url: resolveBrowserAudioUrl(row.source_url),
      duration: durationSec,
      timestamps: [],
      metadata: buildAudioMetadataFromRow(row, track, durationSec),
    };
    let points = buildAdsbAlignedToRecording(stub, allTracksForAlignment, {
      preferVhhh,
      bufferSec: 90,
    });
    if (points.length === 0) {
      points = buildAdsbFromLiveWallClockBuffer(stub, liveAdsb, { bufferSec: 90 });
    }
    const fromLive = buildAdsbFromLiveWallClockBuffer(stub, liveAdsb, { bufferSec: 120 });
    adsbByRecordingId[id] = finalizeRecordingAdsb(
      fromLive.length > 0 ? fromLive : points
    );
  }

  const parsedTimes = usableTracks
    .map((t) => toUnixSeconds(t.timestamp))
    .filter((x) => Number.isFinite(x));
  const baseTime = parsedTimes.length ? Math.min(...parsedTimes) : 0;

  const demoAdsb: ADSBData[] = usableTracks
    .filter((t) => {
      const fid = String(t.flight_id || "");
      if (liveAdsb.length > 0 && DEMO_FLIGHT_IDS.has(fid)) return false;
      return (
        Number.isFinite(Number(t.tracks_latitude)) &&
        Number.isFinite(Number(t.tracks_longitude))
      );
    })
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
        verticalRate:
          t.vertical_rate != null && Number.isFinite(Number(t.vertical_rate))
            ? Number(t.vertical_rate)
            : undefined,
        live: false,
      };
    });

  const adsbMerged: ADSBData[] =
    liveAdsb.length > 0
      ? [...liveAdsb, ...(mapLiveOnly ? [] : demoAdsb)]
      : mapLiveOnly
        ? []
        : demoAdsb;
  /** 未选中录音 / 无 UTC 对齐时的地图回退（实时层） */
  const adsbData = stripSyntheticDetour(enrichVerticalRates(adsbMerged));
  const liveAircraftCount = new Set(
    (liveAdsb.length > 0 ? liveAdsb : adsbData).filter((p) => p.live).map((p) => p.icao24)
  ).size;

  const recordingMeta: Record<string, RecordingMeta> = {};
  for (const rec of recordings) {
    const fileName = String(rec.metadata?.fileName || "").toLowerCase();
    recordingMeta[rec.id] = {
      channel: fileName.includes("cabin") ? "Cabin" : "Radio",
      mine: false,
    };
  }

  return { recordings, adsbData, adsbByRecordingId, recordingMeta, liveAircraftCount };
}

export {
  adsbForRecording,
  isRecordingTimelineAligned,
  pickFallbackPrimaryFromLive,
  rebuildRecordingTimelineFromLive,
  recordingTrackSummary,
  timelineAdsbPoints,
} from "@/lib/recording-adsb-alignment";

