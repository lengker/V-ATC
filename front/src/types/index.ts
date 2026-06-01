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
  /** OpenSky 实时层：不参与录音时间轴过滤，地图始终显示最新位置 */
  live?: boolean;
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
    /** 列表主标题（由 file_name 解析） */
    title?: string;
    /** 原始文件名 */
    fileName?: string;
    /** A5 start_time_utc，用于列表显示为本地采集时间 */
    startTimeUtc?: string;
    /** A5 end_time_utc，与航迹 UTC 窗口对齐 */
    endTimeUtc?: string;
    /** A5 track_id，关联 LNG_TRACKS 链 */
    trackId?: number;
    /** 关联航迹呼号 / flight_id，用于地图默认选中 */
    primaryCallsign?: string;
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
  /** Optional HTTP status code for failed API calls (e.g., 404/500). */
  status?: number;
}
