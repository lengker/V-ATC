import { ADSBData, Annotation, ApiResponse, AudioData, VoiceTimestamp } from "@/types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "";
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
};

export const adsbAPI = {
  getADSBData: async (
    _audioId: string,
    _startTime?: number,
    _endTime?: number
  ): Promise<ApiResponse<ADSBData[]>> => {
    return {
      success: false,
      error: "Alpha A-5 exposes ADSB ingest, but no ADSB list query endpoint yet.",
    };
  },

  getAircraftData: async (
    _icao24: string,
    _startTime?: number,
    _endTime?: number
  ): Promise<ApiResponse<ADSBData[]>> => {
    return {
      success: false,
      error: "Alpha A-5 exposes ADSB ingest, but no aircraft track query endpoint yet.",
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
