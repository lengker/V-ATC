import { ADSBData, Annotation, ApiResponse, AudioData, VoiceTimestamp } from "@/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const A2_API_BASE_URL = process.env.NEXT_PUBLIC_A2_API_BASE_URL || "http://127.0.0.1:8001";
const A1_API_BASE_URL = process.env.NEXT_PUBLIC_A1_API_BASE_URL || API_BASE_URL;
const API_PREFIX = "/api/v1";
const AUDIO_FETCH_TIMEOUT_MS = 20_000;
const ASR_REQUEST_TIMEOUT_MS = 180_000;
const ACCESS_TOKEN_KEY = "alpha.auth.accessToken";
const REFRESH_TOKEN_KEY = "alpha.auth.refreshToken";

type AlphaResponse<T> = {
  code: number;
  message: string;
  data: T;
};

export type AlphaUser = {
  user_id: string;
  username: string;
  display_name: string;
  role: "admin" | "annotator" | string;
  status: string;
  created_at?: string;
  updated_at?: string;
  last_login_at?: string | null;
};

export type LoginResult = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: AlphaUser;
};

export type SignupRequest = {
  username: string;
  password: string;
  display_name?: string;
};

type VoiceInfo = {
  unique_id: string;
  icao_code?: string | null;
  band?: string | null;
  original_time?: string | null;
  file_path?: string | null;
  file_name?: string | null;
  data_type?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  downloadUrl?: string | null;
};

type AsrResult = {
  result_id: string;
  unique_id?: string | null;
  vad_segments?: string | null;
  transcript: string;
  confidence?: number | null;
  engine?: string | null;
  start_time?: string | null;
  end_time?: string | null;
};

type AlphaAsrRecognizeResult = {
  result_id: string;
  unique_id: string;
  transcript: string;
  start_time: string;
  end_time: string;
  engine: string;
  vad_segments?: Array<{
    start: number;
    end: number;
    text?: string;
    lang?: string;
  }>;
};

type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

export type VspAirport = {
  airport_id: string;
  icao_code: string;
  iata_code?: string | null;
  airport_name: string;
  city_name?: string | null;
  country_name?: string | null;
  lat: number;
  lng: number;
  elevation_ft?: number | null;
  extra_json?: string | null;
};

export type VspRunway = {
  runway_id: string;
  airport_id: string;
  runway_designator: string;
  surface_type?: string | null;
  runway_length_m?: number | null;
  runway_width_m?: number | null;
  bearing_deg?: number | null;
  threshold_lat?: number | null;
  threshold_lng?: number | null;
  elevation_ft?: number | null;
  remarks?: string | null;
  extra_json?: string | null;
};

export type VspFrequency = {
  frequency_id: string;
  airport_id: string;
  service_designator?: string | null;
  callsign?: string | null;
  frequency: string;
  hours_of_operation?: string | null;
  remarks?: string | null;
  extra_json?: string | null;
};

export type VspNavaid = {
  navaid_id: string;
  airport_id: string;
  ident: string;
  name?: string | null;
  navaid_type?: string | null;
  frequency?: string | null;
  lat: number;
  lng: number;
  elevation_ft?: number | null;
  hours_of_operation?: string | null;
  remarks?: string | null;
  extra_json?: string | null;
};

export type VspWaypoint = {
  waypoint_id: string;
  name: string;
  type?: string | null;
  lat: number;
  lng: number;
  description?: string | null;
  extra_json?: string | null;
};

export type VspProcedure = {
  procedure_id: string;
  airport_id: string;
  procedure_code: string;
  procedure_name: string;
  procedure_type: string;
  runway?: string | null;
  waypoint_sequence_json?: string | null;
  path_geojson?: string | null;
  extra_json?: string | null;
};

export type VspAirline = {
  airline_id: string;
  airline_code: string;
  airline_name: string;
  airline_short_name?: string | null;
  country_name?: string | null;
  extra_json?: string | null;
};

type A2Response<T> = {
  code: number;
  msg?: string;
  message?: string;
  detail?: string;
  data: T;
  count?: number;
};

export type A2VoiceRecord = {
  unique_id: string;
  icao_code: string;
  band: string;
  original_time?: string | null;
  process_time?: string | null;
  file_path?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  data_type?: "S" | "H" | string;
  start_at: string;
  end_at: string;
  checksum?: string | null;
  valid_status?: string | null;
  downloadUrl?: string;
};

export type A2VoiceQuery = {
  startTime: string;
  endTime: string;
  icaoCode?: string;
  band?: string;
  pageNum?: number;
  pageSize?: number;
};

export type A2DownloadTaskCreate = {
  task_name: string;
  icao_code: string;
  band: string;
  start_time: string;
  end_time: string;
  speed_limit?: number;
  exec_type?: number;
  exec_time?: string | null;
  priority?: "high" | "medium" | "low";
};

type A1Response<T> = {
  data: T;
  count?: number;
  error?: string;
};

type A1Track = {
  track_id?: string;
  callsign?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  altitude?: number | string | null;
  ground_speed?: number | string | null;
  heading?: number | string | null;
  timestamp?: string | number | null;
  source?: string | null;
};

const VHHH_ADSB_BOUNDS = {
  min_latitude: 21.1,
  max_latitude: 23.5,
  min_longitude: 112.45,
  max_longitude: 115.39,
};

export type A2LiveAtcExecute = {
  source_url: string;
  date: string;
  time: string;
  icao_code?: string;
  band?: string;
  speed_limit_kbps?: number;
};

export type A2DownloadExecute = {
  task_id: number;
  source_url: string;
  icao_code?: string;
  band?: string;
  start_time?: string;
  end_time?: string;
  original_time?: string;
  speed_limit_kbps?: number;
};

export type A2RealtimeTaskCreate = {
  task_name: string;
  icao_code: string;
  band: string;
  source_url: string;
  segment_seconds?: number;
  stream_format?: string;
};

export type A2RealtimeAsxCreate = {
  taskName: string;
  icaoCode: string;
  band: string;
  asxContent: string;
  filename?: string;
  segmentSeconds?: number;
  preferredRef?: number;
};

export type A2RealtimeAsxResult = {
  taskId: number;
  streamUrl: string;
  refs: string[];
};

export type A2RealtimeState = {
  taskId: number;
  running: boolean;
  monitoring: boolean;
  receiving: boolean;
  segmentsSaved: number;
  lastSegmentAt?: string | null;
  lastError?: string | null;
  streamUrl?: string | null;
};

export type A1RouteCrawlTaskState = {
  task_id: string;
  provider?: string;
  preset?: string | null;
  interval_seconds?: number;
  status?: string;
  run_count?: number;
  error_count?: number;
  last_started_at?: string | null;
  last_finished_at?: string | null;
  last_error?: string | null;
  last_route_count?: number;
};

export type A2HistoryImport = {
  file: File;
  taskId: number;
  icaoCode: string;
  band: string;
  startAt: string;
  endAt: string;
  originalTime?: string;
};

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function saveAuthTokens(tokens: Pick<LoginResult, "access_token" | "refresh_token">) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token);
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
}

export function clearAuthTokens() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

function toApiResponse<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

function toErrorResponse<T>(error: unknown): ApiResponse<T> {
  return {
    success: false,
    error: error instanceof Error ? error.message : "Unknown error",
  };
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  options: RequestInit,
  timeoutMs: number,
  timeoutMessage: string
) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function fetchAlphaWithTimeout<T>(
  endpoint: string,
  options: RequestInit & { auth?: boolean },
  timeoutMs: number,
  timeoutMessage: string
) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchAlpha<T>(endpoint, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function inferAudioExtension(url: string, contentType?: string | null) {
  const loweredType = (contentType ?? "").toLowerCase();
  if (loweredType.includes("wav") || loweredType.includes("wave")) return "wav";
  if (loweredType.includes("mpeg") || loweredType.includes("mp3")) return "mp3";
  if (loweredType.includes("aac")) return "aac";
  if (loweredType.includes("ogg")) return "ogg";
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const suffix = new URL(url, base).pathname.split(".").pop();
    if (suffix && suffix.length <= 5) return suffix;
  } catch {
    // ignore
  }
  return "wav";
}

function normalizeAsrError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Not Found") || message.includes('"detail"')) {
    return new Error("Alpha ASR 接口未启用：请重启 Alpha 服务，确认 /api/v1/recognize 已加载。");
  }
  return error;
}

async function fetchAlpha<T>(
  endpoint: string,
  options: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const { auth = false, headers, ...rest } = options;
  const isFormData = typeof FormData !== "undefined" && rest.body instanceof FormData;
  const token = getAccessToken();
  const requestHeaders: Record<string, string> = {
    ...(headers as Record<string, string> | undefined),
  };
  if (!isFormData && !requestHeaders["Content-Type"]) {
    requestHeaders["Content-Type"] = "application/json";
  }

  if (auth && token) {
    requestHeaders.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${API_PREFIX}${endpoint}`, {
    ...rest,
    headers: requestHeaders,
  });
  const responseText = await response.text();
  const payload = responseText
    ? (() => {
        try {
          return JSON.parse(responseText) as AlphaResponse<T>;
        } catch {
          return null;
        }
      })()
    : null;

  if (!response.ok || !payload || payload.code !== 0) {
    if (!payload && response.status >= 500) {
      throw new Error("鍚庣鏈嶅姟涓嶅彲鐢紝璇风‘璁?Alpha 鍚庣宸插湪 http://127.0.0.1:8000 鍚姩");
    }
    throw new Error(payload?.message || responseText || `API error: ${response.status} ${response.statusText}`);
  }

  return payload.data;
}

async function fetchA2<T>(endpoint: string, options: RequestInit = {}): Promise<A2Response<T>> {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string> | undefined) ?? {}),
  };
  if (!isFormData && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${A2_API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });
  const responseText = await response.text();
  const payload = responseText
    ? (() => {
        try {
          return JSON.parse(responseText) as A2Response<T>;
        } catch {
          return null;
        }
      })()
    : null;

  if (!response.ok || !payload || payload.code !== 200) {
    throw new Error(
      payload?.msg ||
        payload?.message ||
        payload?.detail ||
        responseText ||
        `璇煶鏈嶅姟閿欒: ${response.status}`
    );
  }

  return payload;
}

async function fetchA1<T>(endpoint: string, options: RequestInit = {}): Promise<A1Response<T>> {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string> | undefined) ?? {}),
  };
  if (!isFormData && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${A1_API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });
  const responseText = await response.text();
  const payload = responseText
    ? (() => {
        try {
          return JSON.parse(responseText) as A1Response<T>;
        } catch {
          return null;
        }
      })()
    : null;

  if (!response.ok || !payload) {
    throw new Error(payload?.error || responseText || `ADS-B service error: ${response.status}`);
  }

  return payload;
}

function buildQuery(params: Record<string, string | number | undefined | null>) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && `${value}`.trim() !== "") {
      qs.set(key, `${value}`);
    }
  });
  return qs.toString();
}

function buildA2VoiceFileUrl(uniqueId: string) {
  return `${A2_API_BASE_URL}/api/a2/voice/file/${encodeURIComponent(uniqueId)}`;
}

function buildA2VoicePlayableUrl(uniqueId: string) {
  return `${buildA2VoiceFileUrl(uniqueId)}/playable`;
}

function buildA2VoiceExportUrl(payload: {
  startTime: string;
  endTime: string;
  icaoCode: string;
  band: string;
  outputFormat?: "wav" | "mp3";
}) {
  return `${A2_API_BASE_URL}/api/a2/voice/export?${buildQuery({
    startTime: payload.startTime,
    endTime: payload.endTime,
    icaoCode: payload.icaoCode,
    band: payload.band,
    outputFormat: payload.outputFormat ?? "wav",
  })}`;
}

function resolveA2Url(url?: string | null) {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${A2_API_BASE_URL}${url.startsWith("/") ? url : `/${url}`}`;
}

function isA2VoiceUrl(url?: string | null) {
  return Boolean(url && /\/api\/a2\/voice\//.test(url));
}

function parseSeconds(value?: string | null): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const time = parseAbsoluteTimeMs(value);
  return time !== undefined ? Math.floor(time / 1000) : undefined;
}

function secondsBetween(start?: string | null, end?: string | null): number {
  const startSeconds = parseSeconds(start);
  const endSeconds = parseSeconds(end);
  if (startSeconds === undefined || endSeconds === undefined) return 0;
  return Math.max(0, endSeconds - startSeconds);
}

function parseDateSeconds(value?: string | null): number | undefined {
  if (!value) return undefined;
  const time = parseAbsoluteTimeMs(value);
  return time !== undefined ? time / 1000 : undefined;
}

function normalizeDateTimeForUtcParse(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const withT = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(withT)) return withT;
  return `${withT}Z`;
}

function parseAbsoluteTimeMs(value?: string | number | null): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(value) > 1e12 ? value : value * 1000;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return Math.abs(numeric) > 1e12 ? numeric : numeric * 1000;
    const ms = Date.parse(normalizeDateTimeForUtcParse(value));
    if (Number.isFinite(ms)) return ms;
  }
  return undefined;
}

function formatIsoUtc(ms: number): string | undefined {
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

function parseA1Timestamp(value: A1Track["timestamp"]): number {
  const ms = parseAbsoluteTimeMs(value);
  return ms !== undefined ? ms / 1000 : Date.now() / 1000;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function mapA1Track(track: A1Track): ADSBData {
  const callsign = (track.callsign || "").trim();
  return {
    id: track.track_id || `${callsign || "track"}-${track.timestamp ?? ""}`,
    timestamp: parseA1Timestamp(track.timestamp),
    icao24: callsign || track.track_id || "UNKNOWN",
    callsign: callsign || undefined,
    latitude: toFiniteNumber(track.latitude),
    longitude: toFiniteNumber(track.longitude),
    altitude: toFiniteNumber(track.altitude),
    speed: toFiniteNumber(track.ground_speed),
    heading: toFiniteNumber(track.heading),
  };
}

function mapA1TrackRelativeToRecording(track: A1Track, recordingStartMs: number): ADSBData | null {
  const trackMs = parseAbsoluteTimeMs(track.timestamp);
  if (trackMs === undefined) return null;
  return {
    ...mapA1Track(track),
    timestamp: (trackMs - recordingStartMs) / 1000,
  };
}

function mapAsrToTimestamp(item: AsrResult, index: number, baseTime?: string | null): VoiceTimestamp {
  const baseSeconds = parseDateSeconds(baseTime);
  const absoluteStart = parseDateSeconds(item.start_time);
  const absoluteEnd = parseDateSeconds(item.end_time);
  const relativeStart =
    baseSeconds !== undefined && absoluteStart !== undefined
      ? Math.max(0, absoluteStart - baseSeconds)
      : parseSeconds(item.start_time);
  const relativeEnd =
    baseSeconds !== undefined && absoluteEnd !== undefined
      ? Math.max(relativeStart ?? index, absoluteEnd - baseSeconds)
      : parseSeconds(item.end_time);

  return {
    id: item.result_id,
    startTime: relativeStart ?? index,
    endTime: relativeEnd ?? index + 1,
    text: item.transcript,
    confidence: item.confidence ?? undefined,
    speaker: item.engine ?? undefined,
  };
}

function parseVadSegments(value?: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (segment): segment is { start: number; end: number; text?: string; lang?: string } =>
        segment !== null &&
        typeof segment === "object" &&
        Number.isFinite(Number((segment as { start?: unknown }).start)) &&
        Number.isFinite(Number((segment as { end?: unknown }).end))
    );
  } catch {
    return [];
  }
}

function mapAsrResultToTimestamps(item: AsrResult, index: number, baseTime?: string | null): VoiceTimestamp[] {
  const segments = parseVadSegments(item.vad_segments);
  if (segments.length === 0) {
    return [mapAsrToTimestamp(item, index, baseTime)];
  }
  return segments.map((segment, segmentIndex) => ({
    id: `${item.result_id}-${segmentIndex}`,
    startTime: Math.max(0, Number(segment.start)),
    endTime: Math.max(Number(segment.start), Number(segment.end)),
    text: segment.text ?? "",
    speaker: segment.lang ? `${item.engine ?? "ASR"} / ${segment.lang}` : item.engine ?? undefined,
  }));
}

function mapVoiceToAudio(item: VoiceInfo, timestamps: VoiceTimestamp[] = []): AudioData {
  const downloadUrl = item.downloadUrl
    ? resolveA2Url(item.downloadUrl)
    : item.file_path && /^https?:\/\//i.test(item.file_path)
      ? resolveA2Url(item.file_path)
      : buildA2VoiceFileUrl(item.unique_id);
  const asrUrl =
    isA2VoiceUrl(item.downloadUrl) || isA2VoiceUrl(item.file_path)
      ? buildA2VoiceFileUrl(item.unique_id)
      : undefined;
  return {
    id: item.unique_id,
    url: downloadUrl,
    duration: Math.max(secondsBetween(item.start_at, item.end_at), ...timestamps.map((ts) => ts.endTime), 0),
    timestamps,
    metadata: {
      icao: item.icao_code || undefined,
      date: item.original_time || undefined,
      startAt: item.start_at || item.original_time || undefined,
      endAt: item.end_at || undefined,
      frequency: item.band || undefined,
      fileName: item.file_name || undefined,
      asrUrl,
    },
  };
}

export const authAPI = {
  signup: async (payload: SignupRequest): Promise<ApiResponse<AlphaUser>> => {
    try {
      const data = await fetchAlpha<AlphaUser>("/auth/signup", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return toApiResponse(data);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  login: async (username: string, password: string): Promise<ApiResponse<LoginResult>> => {
    try {
      const data = await fetchAlpha<LoginResult>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      saveAuthTokens(data);
      return toApiResponse(data);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  me: async (): Promise<ApiResponse<AlphaUser>> => {
    try {
      return toApiResponse(await fetchAlpha<AlphaUser>("/users/me", { auth: true }));
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  logout: async (): Promise<ApiResponse<{ revoked: boolean } | null>> => {
    const refreshToken = getRefreshToken();
    try {
      if (!refreshToken) return toApiResponse(null);
      const data = await fetchAlpha<{ revoked: boolean }>("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      return toApiResponse(data);
    } catch (error) {
      return toErrorResponse(error);
    } finally {
      clearAuthTokens();
    }
  },
};

export const audioAPI = {
  getAudioList: async (): Promise<ApiResponse<AudioData[]>> => {
    try {
      const data = await fetchAlpha<PageResult<VoiceInfo>>("/integration/audio?page=1&page_size=100", { auth: true });
      return toApiResponse(data.items.map((item) => mapVoiceToAudio(item)));
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  getAudio: async (audioId: string): Promise<ApiResponse<AudioData>> => {
    try {
      const [voicePage, asrPage] = await Promise.all([
        fetchAlpha<PageResult<VoiceInfo>>(`/integration/audio?unique_id=${encodeURIComponent(audioId)}`, { auth: true }),
        fetchAlpha<PageResult<AsrResult>>(`/integration/asr?unique_id=${encodeURIComponent(audioId)}&page=1&page_size=100`, {
          auth: true,
        }),
      ]);
      const voice = voicePage.items[0];
      if (!voice) throw new Error("audio not found");
      return toApiResponse(
        mapVoiceToAudio(
          voice,
          asrPage.items.flatMap((item, index) =>
            mapAsrResultToTimestamps(item, index, voice.original_time ?? voice.start_at)
          )
        )
      );
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  recognizeAudio: async (audio: AudioData): Promise<ApiResponse<VoiceTimestamp[]>> => {
    try {
      if (!audio.url) throw new Error("audio url is empty");
      const audioUrl = audio.metadata?.asrUrl || audio.url;
      const audioResponse = await fetchWithTimeout(
        audioUrl,
        {},
        AUDIO_FETCH_TIMEOUT_MS,
        "获取待识别音频超时，请确认 A-2 实时片段已经落盘。"
      );
      if (!audioResponse.ok) {
        throw new Error(`audio fetch failed: ${audioResponse.status} ${audioResponse.statusText}`);
      }
      const blob = await audioResponse.blob();
      const fileName =
        audio.metadata?.fileName?.trim() ||
        `${audio.id}.${inferAudioExtension(audioUrl, audioResponse.headers.get("Content-Type"))}`;
      const formData = new FormData();
      formData.append("file", blob, fileName);
      formData.append("unique_id", audio.id);
      if (audio.metadata?.date) {
        formData.append("recording_start_time", audio.metadata.date);
      }
      const result = await fetchAlphaWithTimeout<AlphaAsrRecognizeResult>(
        "/recognize",
        {
          method: "POST",
          body: formData,
          auth: true,
        },
        ASR_REQUEST_TIMEOUT_MS,
        "ASR 识别超时：首个片段加载模型可能较慢，请稍后重试或查看 Alpha 终端日志。"
      ).catch((error) => {
        throw normalizeAsrError(error);
      });
      const segmentTimestamps =
        result.vad_segments
          ?.filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end))
          .map((segment, index) => ({
            id: `${result.result_id}-${index}`,
            startTime: Math.max(0, Number(segment.start)),
            endTime: Math.max(Number(segment.start), Number(segment.end)),
            text: segment.text ?? "",
            speaker: segment.lang ? `${result.engine} / ${segment.lang}` : result.engine,
          })) ?? [];

      if (segmentTimestamps.length > 0) {
        return toApiResponse(segmentTimestamps);
      }

      return toApiResponse([
        mapAsrToTimestamp(
          {
            result_id: result.result_id,
            unique_id: result.unique_id,
            transcript: result.transcript,
            engine: result.engine,
            start_time: result.start_time,
            end_time: result.end_time,
          },
          0,
          audio.metadata?.date
        ),
      ]);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  updateTimestamp: async (
    audioId: string,
    timestamp: VoiceTimestamp
  ): Promise<ApiResponse<VoiceTimestamp>> => {
    try {
      await fetchAlpha<{ annotation_id: string; version: string }>("/annotations/save", {
        method: "POST",
        body: JSON.stringify({
          task_id: audioId,
          corrected_text: timestamp.text,
          version: "front-v1",
          timestamp_corrections: timestamp,
          annotations: [{ type: "timestamp_update", timestamp_id: timestamp.id }],
        }),
      });
      return toApiResponse(timestamp);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  deleteTimestamp: async (
    audioId: string,
    timestampId: string
  ): Promise<ApiResponse<void>> => {
    try {
      await fetchAlpha("/annotations/save", {
        method: "POST",
        body: JSON.stringify({
          task_id: audioId,
          corrected_text: "",
          version: "front-v1",
          annotations: [{ type: "timestamp_delete", timestamp_id: timestampId }],
        }),
      });
      return toApiResponse(undefined);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  saveA2AudioMetadata: async (record: A2VoiceRecord): Promise<ApiResponse<{ unique_id: string; version: string }>> => {
    try {
      const playableWavUrl = buildA2VoicePlayableUrl(record.unique_id);
      const data = await fetchAlpha<{ unique_id: string; version: string }>("/audio/metadata", {
        method: "POST",
        body: JSON.stringify({
          unique_id: record.unique_id,
          version: "front-a2-import-v1",
          icao_code: record.icao_code,
          band: record.band,
          original_time: record.original_time ?? record.start_at,
          process_time: record.process_time,
          file_path: playableWavUrl,
          file_name: record.file_name ?? `${record.unique_id}.mp3`,
          file_size: record.file_size,
          data_type: record.data_type,
          start_at: record.start_at,
          end_at: record.end_at,
        }),
      });
      return toApiResponse(data);
    } catch (error) {
      return toErrorResponse(error);
    }
  },
};

export const a2VoiceAPI = {
  queryVoice: async (payload: A2VoiceQuery): Promise<ApiResponse<{ items: A2VoiceRecord[]; total: number }>> => {
    try {
      const result = await fetchA2<A2VoiceRecord[]>("/api/a2/voice/query", {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          pageNum: payload.pageNum ?? 1,
          pageSize: payload.pageSize ?? 20,
        }),
      });
      return toApiResponse({ items: result.data, total: result.count ?? result.data.length });
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  listDownloadTasks: async (): Promise<ApiResponse<Record<string, unknown>[]>> => {
    try {
      const result = await fetchA2<Record<string, unknown>[]>("/api/a2/tasks/download");
      return toApiResponse(result.data);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  createDownloadTask: async (payload: A2DownloadTaskCreate): Promise<ApiResponse<{ taskId: number }>> => {
    try {
      const result = await fetchA2<{ taskId: number }>("/api/a2/tasks/download", {
        method: "POST",
        body: JSON.stringify({
          speed_limit: 0,
          exec_type: 1,
          priority: "medium",
          ...payload,
        }),
      });
      return toApiResponse(result.data);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  executeDownloadTask: async (payload: A2DownloadExecute): Promise<ApiResponse<A2VoiceRecord>> => {
    try {
      const result = await fetchA2<A2VoiceRecord>("/api/a2/tasks/download/execute", {
        method: "POST",
        body: JSON.stringify({ speed_limit_kbps: 0, ...payload }),
      });
      return toApiResponse(result.data);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  executeLiveAtcDownload: async (
    payload: A2LiveAtcExecute
  ): Promise<ApiResponse<{ taskId?: number; record?: A2VoiceRecord; metadata?: Record<string, unknown> }>> => {
    try {
      const result = await fetchA2<{ taskId?: number; record?: A2VoiceRecord; metadata?: Record<string, unknown> }>(
        "/api/a2/tasks/download/liveatc/execute",
        {
          method: "POST",
          body: JSON.stringify({ speed_limit_kbps: 0, ...payload }),
        }
      );
      return toApiResponse(result.data);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  listRealtimeTasks: async (): Promise<ApiResponse<Record<string, unknown>[]>> => {
    try {
      const result = await fetchA2<Record<string, unknown>[]>("/api/a2/tasks/realtime");
      return toApiResponse(result.data);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  createRealtimeTask: async (payload: A2RealtimeTaskCreate): Promise<ApiResponse<{ taskId: number }>> => {
    try {
      const result = await fetchA2<{ taskId: number }>("/api/a2/tasks/realtime", {
        method: "POST",
        body: JSON.stringify({
          segment_seconds: 60,
          ...payload,
        }),
      });
      return toApiResponse(result.data);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  createRealtimeTaskFromAsx: async (payload: A2RealtimeAsxCreate): Promise<ApiResponse<A2RealtimeAsxResult>> => {
    try {
      const formData = new FormData();
      formData.append("taskName", payload.taskName);
      formData.append("icaoCode", payload.icaoCode);
      formData.append("band", payload.band);
      formData.append("segmentSeconds", `${payload.segmentSeconds ?? 60}`);
      formData.append("preferredRef", `${payload.preferredRef ?? 0}`);
      formData.append(
        "file",
        new Blob([payload.asxContent], { type: "video/x-ms-asf" }),
        payload.filename ?? "live.asx"
      );

      const result = await fetchA2<A2RealtimeAsxResult>("/api/a2/tasks/realtime/from-asx", {
        method: "POST",
        body: formData,
      });
      return toApiResponse(result.data);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  startRealtimeReceive: async (taskId: number): Promise<ApiResponse<A2RealtimeState>> => {
    try {
      const result = await fetchA2<A2RealtimeState>("/api/a2/tasks/realtime/start-receive", {
        method: "POST",
        body: JSON.stringify({ task_id: taskId }),
      });
      return toApiResponse(result.data);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  stopRealtimeReceive: async (taskId: number): Promise<ApiResponse<A2RealtimeState>> => {
    try {
      const result = await fetchA2<A2RealtimeState>(`/api/a2/tasks/realtime/${encodeURIComponent(taskId)}/stop-receive`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      return toApiResponse(result.data);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  getRealtimeState: async (taskId: number): Promise<ApiResponse<A2RealtimeState>> => {
    try {
      const result = await fetchA2<A2RealtimeState>(`/api/a2/tasks/realtime/${encodeURIComponent(taskId)}/state`);
      return toApiResponse(result.data);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  syncMetadata: async (): Promise<ApiResponse<{ missing: number; updated: number; scanned: number }>> => {
    try {
      const result = await fetchA2<{ missing: number; updated: number; scanned: number }>("/api/a2/sync/run", {
        method: "POST",
        body: JSON.stringify({}),
      });
      return toApiResponse(result.data);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  importLiveAtcHistoryFile: async (
    file: File,
    taskId?: number
  ): Promise<ApiResponse<A2VoiceRecord>> => {
    try {
      const formData = new FormData();
      formData.append("file", file);
      const query = buildQuery({ taskId });
      const result = await fetchA2<A2VoiceRecord>(
        `/api/a2/voice/import/history/liveatc${query ? `?${query}` : ""}`,
        {
          method: "POST",
          body: formData,
        }
      );
      return toApiResponse(result.data);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  importHistoryFile: async (payload: A2HistoryImport): Promise<ApiResponse<A2VoiceRecord>> => {
    try {
      const formData = new FormData();
      formData.append("file", payload.file);
      const result = await fetchA2<A2VoiceRecord>(
        `/api/a2/voice/import/history?${buildQuery({
          taskId: payload.taskId,
          icaoCode: payload.icaoCode,
          band: payload.band,
          startAt: payload.startAt,
          endAt: payload.endAt,
          originalTime: payload.originalTime,
        })}`,
        {
          method: "POST",
          body: formData,
        }
      );
      return toApiResponse(result.data);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  exportVoiceUrl: buildA2VoiceExportUrl,

  fileUrl: buildA2VoiceFileUrl,

  playableFileUrl: buildA2VoicePlayableUrl,
};

export const a1RouteAPI = {
  startRouteCrawlTask: async (payload: {
    taskId?: string;
    provider?: "airplanes-live" | "opensky";
    preset?: string;
    limit?: number;
    intervalSeconds?: number;
    maxRoutePoints?: number;
    mergeSources?: boolean;
  }): Promise<ApiResponse<A1RouteCrawlTaskState>> => {
    try {
      const result = await fetchA1<A1RouteCrawlTaskState>("/api/adsb/routes/crawl-tasks/start", {
        method: "POST",
        body: JSON.stringify({
          task_id: payload.taskId,
          provider: payload.provider ?? "airplanes-live",
          preset: payload.preset ?? "vhhh",
          limit: payload.limit ?? 1000,
          interval_seconds: payload.intervalSeconds ?? 30,
          max_route_points: payload.maxRoutePoints ?? 5000,
          merge_sources: payload.mergeSources ?? false,
        }),
      });
      return toApiResponse(result.data);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  stopRouteCrawlTask: async (taskId: string): Promise<ApiResponse<A1RouteCrawlTaskState>> => {
    try {
      const result = await fetchA1<A1RouteCrawlTaskState>(
        `/api/adsb/routes/crawl-tasks/${encodeURIComponent(taskId)}/stop`,
        {
          method: "POST",
          body: JSON.stringify({}),
        }
      );
      return toApiResponse(result.data);
    } catch (error) {
      return toErrorResponse(error);
    }
  },
};

export const adsbAPI = {
  getADSBData: async (
    audio: AudioData,
    options?: { bufferSeconds?: number }
  ): Promise<ApiResponse<ADSBData[]>> => {
    try {
      const recordingStartMs = parseAbsoluteTimeMs(audio.metadata?.startAt ?? audio.metadata?.date);
      const recordingEndMs =
        parseAbsoluteTimeMs(audio.metadata?.endAt) ??
        (recordingStartMs !== undefined && Number.isFinite(audio.duration)
          ? recordingStartMs + audio.duration * 1000
          : undefined);

      if (recordingStartMs === undefined || recordingEndMs === undefined) {
        return toApiResponse([]);
      }

      const bufferMs = (options?.bufferSeconds ?? 5) * 1000;
      const query = buildQuery({
        ...VHHH_ADSB_BOUNDS,
        start_time: formatIsoUtc(recordingStartMs - bufferMs),
        end_time: formatIsoUtc(recordingEndMs + bufferMs),
        limit: 1000,
      });
      const result = await fetchA1<A1Track[]>(`/api/adsb/tracks?${query}`);
      return toApiResponse(
        result.data
          .map((track) => mapA1TrackRelativeToRecording(track, recordingStartMs))
          .filter((track): track is ADSBData => Boolean(track))
          .sort((a, b) => a.timestamp - b.timestamp)
      );
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  getAircraftData: async (
    icao24: string,
    _startTime?: number,
    _endTime?: number
  ): Promise<ApiResponse<ADSBData[]>> => {
    try {
      const query = buildQuery({
        callsign: icao24,
        ...VHHH_ADSB_BOUNDS,
        limit: 1000,
      });
      const result = await fetchA1<A1Track[]>(`/api/adsb/tracks?${query}`);
      return toApiResponse(result.data.map(mapA1Track));
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  refreshVhhhFromAirplanesLive: async (): Promise<ApiResponse<{ saved_count?: number; fetched_count?: number }>> => {
    try {
      const result = await fetchA1<{ saved_count?: number; fetched_count?: number }>(
        "/api/adsb/sources/airplanes-live/fetch",
        {
          method: "POST",
          body: JSON.stringify({ preset: "vhhh", limit: 1000 }),
        }
      );
      return toApiResponse(result.data);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

};

export const annotationAPI = {
  getAnnotations: async (audioId: string): Promise<ApiResponse<Annotation[]>> => {
    try {
      const data = await fetchAlpha<{
        task_id: string;
        annotation_result?: {
          annotation_id: string;
          corrected_text?: string | null;
          annotations?: string | null;
        } | null;
      } | null>(`/annotations/load?unique_id=${encodeURIComponent(audioId)}`);

      if (!data?.annotation_result) return toApiResponse([]);
      return toApiResponse([
        {
          id: data.annotation_result.annotation_id,
          audioId,
          timestamp: Date.now(),
          text: data.annotation_result.corrected_text || "",
          edited: true,
          notes: data.annotation_result.annotations || undefined,
        },
      ]);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  createAnnotation: async (
    annotation: Omit<Annotation, "id">
  ): Promise<ApiResponse<Annotation>> => {
    try {
      const data = await fetchAlpha<{ annotation_id: string }>("/annotations/save", {
        method: "POST",
        body: JSON.stringify({
          task_id: annotation.audioId,
          corrected_text: annotation.text,
          version: "front-v1",
          annotations: annotation,
        }),
      });
      return toApiResponse({ ...annotation, id: data.annotation_id });
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  updateAnnotation: async (annotation: Annotation): Promise<ApiResponse<Annotation>> => {
    try {
      await fetchAlpha("/annotations/save", {
        method: "POST",
        body: JSON.stringify({
          task_id: annotation.audioId,
          corrected_text: annotation.text,
          version: "front-v1",
          annotations: annotation,
        }),
      });
      return toApiResponse(annotation);
    } catch (error) {
      return toErrorResponse(error);
    }
  },

  deleteAnnotation: async (annotationId: string): Promise<ApiResponse<void>> => {
    try {
      await fetchAlpha("/annotations/save", {
        method: "POST",
        body: JSON.stringify({
          task_id: annotationId,
          corrected_text: "",
          version: "front-v1",
          annotations: [{ type: "annotation_delete", annotation_id: annotationId }],
        }),
      });
      return toApiResponse(undefined);
    } catch (error) {
      return toErrorResponse(error);
    }
  },
};

export const vspAPI = {
  airports: (icaoCode?: string) =>
    fetchAlpha<VspAirport[]>(`/vsp/airports${icaoCode ? `?icao_code=${encodeURIComponent(icaoCode)}` : ""}`),
  waypoints: (keyword?: string, pageSize = 500) => {
    const query = buildQuery({ keyword, page: 1, page_size: pageSize });
    return fetchAlpha<PageResult<VspWaypoint>>(`/vsp/waypoints${query ? `?${query}` : ""}`);
  },
  procedures: (airportId?: string) =>
    fetchAlpha<VspProcedure[]>(`/vsp/procedures${airportId ? `?airport_id=${encodeURIComponent(airportId)}` : ""}`),
  runways: (airportId?: string) =>
    fetchAlpha<VspRunway[]>(`/vsp/runways${airportId ? `?airport_id=${encodeURIComponent(airportId)}` : ""}`),
  frequencies: (airportId?: string) =>
    fetchAlpha<VspFrequency[]>(`/vsp/frequencies${airportId ? `?airport_id=${encodeURIComponent(airportId)}` : ""}`),
  navaids: (airportId?: string) =>
    fetchAlpha<VspNavaid[]>(`/vsp/navaids${airportId ? `?airport_id=${encodeURIComponent(airportId)}` : ""}`),
  airlines: (keyword?: string) =>
    fetchAlpha<VspAirline[]>(`/vsp/airlines${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ""}`),
};
