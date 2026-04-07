import { AudioData, ADSBData } from "@/types";

// 示例音频数据（方便前端在没有后端的情况下预览 UI）
// 实际接入时，请从后端返回同样结构的数据替换这里的 mock。

export const demoAudio: AudioData = {
  id: "demo-audio-001",
  // 暂未接后端音频：留空会触发前端生成 mock WAV（见 AudioWaveform）
  url: "",
  duration: 47,
  metadata: {
    icao: "VHHH",
    date: "2025-01-01",
    frequency: "118.200 MHz",
  },
  timestamps: [
    {
      id: "ts-1",
      startTime: 2,
      endTime: 6,
      text: "Hong Kong Tower, CPA123, holding short runway 07R, ready for departure.",
      speaker: "Pilot",
      confidence: 0.94,
    },
    {
      id: "ts-2",
      startTime: 7,
      endTime: 12,
      text: "CPA123, Hong Kong Tower, wind 080 at 6, runway 07R cleared for takeoff.",
      speaker: "ATC",
      confidence: 0.97,
    },
    {
      id: "ts-3",
      startTime: 18,
      endTime: 24,
      text: "Cleared for takeoff 07R, CPA123.",
      speaker: "Pilot",
      confidence: 0.96,
    },
    {
      id: "ts-4",
      startTime: 30,
      endTime: 38,
      text: "CPA123, contact Departure 135.2, good day.",
      speaker: "ATC",
      confidence: 0.95,
    },
    {
      id: "ts-5",
      startTime: 40,
      endTime: 47,
      text: "Departure on 135.2, CPA123, good day.",
      speaker: "Pilot",
      confidence: 0.93,
    },
  ],
};

export const demoAudio2: AudioData = {
  id: "demo-audio-002",
  url: "",
  duration: 40,
  metadata: {
    icao: "VHHH",
    date: "2025-01-02",
    frequency: "121.600 MHz",
  },
  timestamps: [
    {
      id: "ts2-1",
      startTime: 4,
      endTime: 10,
      text: "Dragonair 456, taxi to holding point runway 07L via Taxiway A.",
      speaker: "ATC",
      confidence: 0.91,
    },
    {
      id: "ts2-2",
      startTime: 12,
      endTime: 18,
      text: "Taxi holding point 07L via A, Dragonair 456.",
      speaker: "Pilot",
      confidence: 0.9,
    },
    {
      id: "ts2-3",
      startTime: 22,
      endTime: 28,
      text: "Dragonair 456, line up runway 07L and wait.",
      speaker: "ATC",
      confidence: 0.92,
    },
    {
      id: "ts2-4",
      startTime: 33,
      endTime: 40,
      text: "Line up and wait 07L, Dragonair 456.",
      speaker: "Pilot",
      confidence: 0.9,
    },
  ],
};

export const demoAdsbTrack: ADSBData[] = [
  {
    id: "adsb-1",
    timestamp: 0,
    icao24: "cpa123",
    callsign: "CPA123",
    latitude: 22.305,
    longitude: 113.918,
    altitude: 0,
    speed: 0,
    heading: 70,
  },
  {
    id: "adsb-2",
    timestamp: 10,
    icao24: "cpa123",
    callsign: "CPA123",
    latitude: 22.31,
    longitude: 113.93,
    altitude: 1500,
    speed: 150,
    heading: 70,
  },
  {
    id: "adsb-3",
    timestamp: 20,
    icao24: "cpa123",
    callsign: "CPA123",
    latitude: 22.33,
    longitude: 113.95,
    altitude: 4500,
    speed: 210,
    heading: 75,
  },
  {
    id: "adsb-4",
    timestamp: 30,
    icao24: "cpa123",
    callsign: "CPA123",
    latitude: 22.36,
    longitude: 113.97,
    altitude: 8000,
    speed: 240,
    heading: 80,
  },
  {
    id: "adsb-5",
    timestamp: 45,
    icao24: "cpa123",
    callsign: "CPA123",
    latitude: 22.40,
    longitude: 114.02,
    altitude: 12000,
    speed: 260,
    heading: 85,
  },
  {
    id: "adsb-6",
    timestamp: 5,
    icao24: "hke456",
    callsign: "HKE456",
    latitude: 22.301,
    longitude: 113.925,
    altitude: 200,
    speed: 40,
    heading: 65,
  },
  {
    id: "adsb-7",
    timestamp: 15,
    icao24: "hke456",
    callsign: "HKE456",
    latitude: 22.307,
    longitude: 113.93,
    altitude: 1200,
    speed: 130,
    heading: 70,
  },
  {
    id: "adsb-8",
    timestamp: 25,
    icao24: "hke456",
    callsign: "HKE456",
    latitude: 22.319,
    longitude: 113.942,
    altitude: 3500,
    speed: 180,
    heading: 73,
  },
  {
    id: "adsb-9",
    timestamp: 35,
    icao24: "hke456",
    callsign: "HKE456",
    latitude: 22.337,
    longitude: 113.958,
    altitude: 6200,
    speed: 230,
    heading: 78,
  },
];

export const demoRecordings: AudioData[] = [demoAudio, demoAudio2];

export type RecordingMeta = {
  channel: "Radio" | "Cabin";
  mine?: boolean;
};

export const demoRecordingMeta: Record<string, RecordingMeta> = {
  "demo-audio-001": { channel: "Radio", mine: true },
  "demo-audio-002": { channel: "Cabin", mine: false },
};
