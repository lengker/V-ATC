import { ADSBData, Annotation, ApiResponse, AudioData, VoiceTimestamp } from "@/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
const A2_API_BASE_URL = process.env.NEXT_PUBLIC_A2_API_BASE_URL || API_BASE_URL;
const API_PREFIX = "/api/v1";
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
  start_at?: string | null;
  end_at?: string | null;
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

type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

type A2Response<T> = {
  code: number;
  msg?: string;
  message?: string;
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

export type A2LiveAtcExecute = {
  source_url: string;
  date: string;
  time: string;
  icao_code?: string;
  band?: string;
  speed_limit_kbps?: number;
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

async function fetchAlpha<T>(
  endpoint: string,
  options: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const { auth = false, headers, ...rest } = options;
  const token = getAccessToken();
  const requestHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(headers as Record<string, string> | undefined),
  };

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
      throw new Error("后端服务不可用，请确认 Alpha 后端已在 http://127.0.0.1:8000 启动");
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
    throw new Error(payload?.msg || payload?.message || responseText || `语音服务错误: ${response.status}`);
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

function parseSeconds(value?: string | null): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.floor(time / 1000) : undefined;
}

function secondsBetween(start?: string | null, end?: string | null): number {
  const startSeconds = parseSeconds(start);
  const endSeconds = parseSeconds(end);
  if (startSeconds === undefined || endSeconds === undefined) return 0;
  return Math.max(0, endSeconds - startSeconds);
}

function mapAsrToTimestamp(item: AsrResult, index: number): VoiceTimestamp {
  return {
    id: item.result_id,
    startTime: parseSeconds(item.start_time) ?? index,
    endTime: parseSeconds(item.end_time) ?? index + 1,
    text: item.transcript,
    confidence: item.confidence ?? undefined,
    speaker: item.engine ?? undefined,
  };
}

function mapVoiceToAudio(item: VoiceInfo, timestamps: VoiceTimestamp[] = []): AudioData {
  return {
    id: item.unique_id,
    url: item.file_path || "",
    duration: Math.max(secondsBetween(item.start_at, item.end_at), ...timestamps.map((ts) => ts.endTime), 0),
    timestamps,
    metadata: {
      icao: item.icao_code || undefined,
      date: item.original_time || undefined,
      frequency: item.band || undefined,
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
      return toApiResponse(mapVoiceToAudio(voice, asrPage.items.map(mapAsrToTimestamp)));
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
      const data = await fetchAlpha<{ unique_id: string; version: string }>("/audio/metadata", {
        method: "POST",
        body: JSON.stringify({
          unique_id: record.unique_id,
          version: "front-a2-import-v1",
          icao_code: record.icao_code,
          band: record.band,
          original_time: record.original_time ?? record.start_at,
          process_time: record.process_time,
          file_path: buildA2VoiceFileUrl(record.unique_id),
          file_name: record.file_name,
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

  exportVoiceUrl: (payload: A2VoiceQuery & { outputFormat?: "wav" | "mp3"; icaoCode: string; band: string }) =>
    `${A2_API_BASE_URL}/api/a2/voice/export?${buildQuery({
      startTime: payload.startTime,
      endTime: payload.endTime,
      icaoCode: payload.icaoCode,
      band: payload.band,
      outputFormat: payload.outputFormat ?? "wav",
    })}`,

  fileUrl: buildA2VoiceFileUrl,
};

export const adsbAPI = {
  getADSBData: async (
    _audioId: string,
    _startTime?: number,
    _endTime?: number
  ): Promise<ApiResponse<ADSBData[]>> => {
    return {
      success: false,
      error: "后端已提供 ADSB 写入能力，但暂未提供 ADSB 列表查询接口。",
    };
  },

  getAircraftData: async (
    _icao24: string,
    _startTime?: number,
    _endTime?: number
  ): Promise<ApiResponse<ADSBData[]>> => {
    return {
      success: false,
      error: "后端已提供 ADSB 写入能力，但暂未提供单机轨迹查询接口。",
    };
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
    fetchAlpha(`/vsp/airports${icaoCode ? `?icao_code=${encodeURIComponent(icaoCode)}` : ""}`),
  waypoints: (keyword?: string) =>
    fetchAlpha(`/vsp/waypoints${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ""}`),
  procedures: (airportId?: string) =>
    fetchAlpha(`/vsp/procedures${airportId ? `?airport_id=${encodeURIComponent(airportId)}` : ""}`),
  runways: (airportId?: string) =>
    fetchAlpha(`/vsp/runways${airportId ? `?airport_id=${encodeURIComponent(airportId)}` : ""}`),
  frequencies: (airportId?: string) =>
    fetchAlpha(`/vsp/frequencies${airportId ? `?airport_id=${encodeURIComponent(airportId)}` : ""}`),
  navaids: (airportId?: string) =>
    fetchAlpha(`/vsp/navaids${airportId ? `?airport_id=${encodeURIComponent(airportId)}` : ""}`),
};
