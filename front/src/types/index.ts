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
    startAt?: string;
    endAt?: string;
    frequency?: string;
    fileName?: string;
    asrUrl?: string;
  };
}

export type RecordingMeta = {
  channel: "Radio" | "Cabin";
  mine?: boolean;
};

export type StaticPoint = {
  id: string;
  name: string;
  kind: "waypoint" | "landmark" | "navaid";
  lat: number;
  lon: number;
  note?: string;
};

export type StaticLine = {
  id: string;
  name: string;
  kind: "runway" | "taxiway" | "sid" | "star";
  points: Array<{ lat: number; lon: number }>;
  note?: string;
};

export type RoutePolyline = {
  id: string;
  name: string;
  kind: "planned" | "detour" | "missed";
  points: Array<{ lat: number; lon: number }>;
  note?: string;
  endLabel?: string;
};

export type ObstacleZone = {
  id: string;
  name: string;
  kind: "nfz" | "weather" | "terrain";
  polygon: Array<{ lat: number; lon: number }>;
  note?: string;
};

export type VhhhStaticLayers = {
  runways: StaticLine[];
  taxiways: StaticLine[];
  waypoints: StaticPoint[];
  landmarks: StaticPoint[];
  procedures: Array<{ id: string; type: "SID" | "STAR"; name: string; runway?: string; note?: string }>;
  routeLines?: RoutePolyline[];
  obstacleZones?: ObstacleZone[];
};

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
