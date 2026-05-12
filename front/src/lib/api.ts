import { ApiResponse, AudioData, ADSBData, VoiceTimestamp, Annotation } from "@/types";
import { annotationsExtApi } from "@/lib/backend-api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

async function fetchAPI<T>(
  endpoint: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
      let bodyMessage = "";
      if (contentType.includes("application/json")) {
        try {
          const maybe = (await response.json()) as any;
          bodyMessage =
            typeof maybe?.error === "string"
              ? maybe.error
              : typeof maybe?.message === "string"
                ? maybe.message
                : "";
        } catch {
          // ignore
        }
      } else {
        try {
          bodyMessage = (await response.text()).slice(0, 200);
        } catch {
          // ignore
        }
      }

      const status = response.status;
      const statusLabel = response.statusText || "Request failed";
      const tail = bodyMessage ? `: ${bodyMessage}` : "";
      return {
        success: false,
        status,
        error: `HTTP ${status} ${statusLabel}${tail}`,
      };
    }

    if (contentType.includes("application/json")) {
      const data = (await response.json()) as unknown;
      // Backward compatible: support both wrapped ApiResponse and plain JSON payload.
      if (
        data &&
        typeof data === "object" &&
        "success" in (data as Record<string, unknown>) &&
        typeof (data as Record<string, unknown>).success === "boolean"
      ) {
        return data as ApiResponse<T>;
      }
      return { success: true, data: data as T };
    }

    // Unexpected non-JSON success response
    return {
      success: false,
      status: response.status,
      error: "Invalid response type (expected JSON)",
    };
  } catch (error) {
    return {
      success: false,
      status: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// 音频相关 API
export const audioAPI = {
  // 获取音频列表
  getAudioList: async (): Promise<ApiResponse<AudioData[]>> => {
    return fetchAPI<AudioData[]>("/api/audio/list");
  },

  // 获取音频详情
  getAudio: async (audioId: string): Promise<ApiResponse<AudioData>> => {
    return fetchAPI<AudioData>(`/api/audio/${audioId}`);
  },

  // 更新时间戳
  updateTimestamp: async (
    audioId: string,
    timestamp: VoiceTimestamp
  ): Promise<ApiResponse<VoiceTimestamp>> => {
    void audioId;
    const annotationId = Number(timestamp.id);
    if (!Number.isFinite(annotationId)) {
      return {
        success: false,
        error: "当前时间戳不是后端 annotation_id，无法直接更新",
      };
    }
    try {
      await annotationsExtApi.update(annotationId, {
        relative_start: timestamp.startTime,
        relative_end: timestamp.endTime,
        annotation_text: timestamp.text,
      });
      return { success: true, data: timestamp };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Update annotation failed",
      };
    }
  },

  // 删除时间戳
  deleteTimestamp: async (
    audioId: string,
    timestampId: string
  ): Promise<ApiResponse<void>> => {
    return fetchAPI<void>(
      `/api/audio/${audioId}/timestamps/${timestampId}`,
      {
        method: "DELETE",
      }
    );
  },
};

// ADSB 相关 API
export const adsbAPI = {
  // 获取 ADSB 数据
  getADSBData: async (
    audioId: string,
    startTime?: number,
    endTime?: number
  ): Promise<ApiResponse<ADSBData[]>> => {
    const params = new URLSearchParams();
    if (startTime !== undefined) params.append("start_time", startTime.toString());
    if (endTime !== undefined) params.append("end_time", endTime.toString());
    
    const query = params.toString();
    return fetchAPI<ADSBData[]>(
      `/api/adsb/${audioId}${query ? `?${query}` : ""}`
    );
  },

  // 获取特定飞机的 ADSB 数据
  getAircraftData: async (
    icao24: string,
    startTime?: number,
    endTime?: number
  ): Promise<ApiResponse<ADSBData[]>> => {
    const params = new URLSearchParams();
    if (startTime !== undefined) params.append("start_time", startTime.toString());
    if (endTime !== undefined) params.append("end_time", endTime.toString());
    
    const query = params.toString();
    return fetchAPI<ADSBData[]>(
      `/api/adsb/aircraft/${icao24}${query ? `?${query}` : ""}`
    );
  },
};

// 标注相关 API
export const annotationAPI = {
  // 获取标注列表
  getAnnotations: async (
    audioId: string
  ): Promise<ApiResponse<Annotation[]>> => {
    return fetchAPI<Annotation[]>(`/api/annotations/${audioId}`);
  },

  // 创建标注
  createAnnotation: async (
    annotation: Omit<Annotation, "id">
  ): Promise<ApiResponse<Annotation>> => {
    try {
      const created = await annotationsExtApi.create({
        audio_id: Number(annotation.audioId),
        relative_start: annotation.timestamp,
        relative_end: annotation.timestamp,
        annotation_text: annotation.text,
        is_annotated: annotation.edited ? 1 : 0,
      });
      const id = Array.isArray(created)
        ? Number(created[0]?.annotation_id)
        : Number(Array.isArray(created.annotation_id) ? created.annotation_id[0] : created.annotation_id);
      return { success: true, data: { ...annotation, id: String(id) } as Annotation };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Create annotation failed" };
    }
  },

  // 更新标注
  updateAnnotation: async (
    annotation: Annotation
  ): Promise<ApiResponse<Annotation>> => {
    try {
      const id = Number(annotation.id);
      if (!Number.isFinite(id)) return { success: false, error: "Invalid annotation id" };
      await annotationsExtApi.update(id, {
        annotation_text: annotation.text,
        relative_start: annotation.timestamp,
        relative_end: annotation.timestamp,
        is_annotated: annotation.edited ? 1 : 0,
      });
      return { success: true, data: annotation };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Update annotation failed" };
    }
  },

  // 删除标注
  deleteAnnotation: async (
    annotationId: string
  ): Promise<ApiResponse<void>> => {
    try {
      const id = Number(annotationId);
      if (!Number.isFinite(id)) return { success: false, error: "Invalid annotation id" };
      await annotationsExtApi.deleteOne(id);
      return { success: true, data: undefined };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : "Delete annotation failed" };
    }
  },
};
