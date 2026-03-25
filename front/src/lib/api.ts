import { ApiResponse, AudioData, ADSBData, VoiceTimestamp, Annotation } from "@/types";

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

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    return {
      success: false,
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
    return fetchAPI<VoiceTimestamp>(`/api/audio/${audioId}/timestamps`, {
      method: "PUT",
      body: JSON.stringify(timestamp),
    });
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
    return fetchAPI<Annotation>("/api/annotations", {
      method: "POST",
      body: JSON.stringify(annotation),
    });
  },

  // 更新标注
  updateAnnotation: async (
    annotation: Annotation
  ): Promise<ApiResponse<Annotation>> => {
    return fetchAPI<Annotation>(`/api/annotations/${annotation.id}`, {
      method: "PUT",
      body: JSON.stringify(annotation),
    });
  },

  // 删除标注
  deleteAnnotation: async (
    annotationId: string
  ): Promise<ApiResponse<void>> => {
    return fetchAPI<void>(`/api/annotations/${annotationId}`, {
      method: "DELETE",
    });
  },
};
