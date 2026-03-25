// ADSB 航迹数据类型
export interface ADSBData {
  id: string;
  timestamp: number;
  icao24: string;
  callsign?: string;
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;
  heading: number;
  verticalRate?: number;
}

// 语音时间戳数据类型
export interface VoiceTimestamp {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  confidence?: number;
  speaker?: string;
}

// 语音数据
export interface AudioData {
  id: string;
  url: string;
  duration: number;
  timestamps: VoiceTimestamp[];
  metadata?: {
    icao?: string;
    date?: string;
    frequency?: string;
  };
}

// 标注数据类型
export interface Annotation {
  id: string;
  audioId: string;
  timestamp: number;
  text: string;
  edited: boolean;
  tags?: string[];
  notes?: string;
}

// API 响应类型
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
