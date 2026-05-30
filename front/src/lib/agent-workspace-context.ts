import type { RecordingMeta } from "@/mock/demo-data";
import { getRecordingDisplayName } from "@/lib/recording-display";
import type { ADSBData, AudioData, VoiceTimestamp } from "@/types";

export type AgentWorkspaceSnapshot = {
  generatedAt: string;
  recordings: Array<{
    id: string;
    displayName: string;
    durationSec: number;
    segmentCount: number;
    channel?: string;
    icao?: string;
    date?: string;
    isActive: boolean;
  }>;
  activeRecording: {
    id: string;
    displayName: string;
    durationSec: number;
    metadata?: {
      title?: string;
      fileName?: string;
      startTimeUtc?: string;
      icao?: string;
      date?: string;
    };
    transcript: Array<{
      id: string;
      startTime: number;
      endTime: number;
      speaker?: string;
      text: string;
      isSelected: boolean;
      isAtPlayhead: boolean;
    }>;
    transcriptStats: {
      segmentCount: number;
      totalTextChars: number;
      speakers: string[];
    };
  };
  playback: {
    currentTimeSec: number;
    timelineMaxSec: number;
  };
  map: {
    selectedAircraft?: string;
    visibleAircraftCount: number;
    liveAircraftCount?: number;
    liveStale?: boolean;
    liveError?: string;
    aircraftSample: Array<{
      icao24: string;
      callsign?: string;
      altitude?: number;
      speed?: number;
      heading?: number;
      live?: boolean;
    }>;
    selectedAircraftDetail?: {
      icao24: string;
      callsign?: string;
      pointCount: number;
      latestAltitude?: number;
      latestSpeed?: number;
    };
  };
};

const MAX_TRANSCRIPT_SEGMENTS = 120;
const MAX_AIRCRAFT_SAMPLE = 24;

function nearestPointForTime(points: ADSBData[], timeSec: number): ADSBData | null {
  if (!points.length) return null;
  let best = points[0];
  let bestDt = Math.abs(points[0].timestamp - timeSec);
  for (const p of points) {
    const dt = Math.abs(p.timestamp - timeSec);
    if (dt < bestDt) {
      best = p;
      bestDt = dt;
    }
  }
  return best;
}

function truncateTranscript(segments: VoiceTimestamp[], playhead: number, selectedId: string | null) {
  const mapped = segments.map((ts) => {
    const atPlayhead = playhead >= ts.startTime && playhead <= ts.endTime;
    return {
      id: ts.id,
      startTime: ts.startTime,
      endTime: ts.endTime,
      speaker: ts.speaker,
      text: ts.text,
      isSelected: selectedId === ts.id,
      isAtPlayhead: atPlayhead,
    };
  });

  if (mapped.length <= MAX_TRANSCRIPT_SEGMENTS) return mapped;

  const selectedIdx = selectedId ? mapped.findIndex((s) => s.id === selectedId) : -1;
  const head = mapped.slice(0, 50);
  const tail = mapped.slice(-50);
  const omitted = mapped.length - head.length - tail.length;
  const middle: typeof mapped = [];
  if (selectedIdx >= 0 && selectedIdx >= 50 && selectedIdx < mapped.length - 50) {
    middle.push(mapped[selectedIdx]);
  }
  return [
    ...head,
    {
      id: "__truncated__",
      startTime: 0,
      endTime: 0,
      text: `… 省略中间 ${omitted} 段（共 ${mapped.length} 段）…`,
      isSelected: false,
      isAtPlayhead: false,
    },
    ...middle.filter((m) => m.id !== "__truncated__"),
    ...tail,
  ];
}

export function buildAgentWorkspaceSnapshot(input: {
  audioData: AudioData;
  timestamps: VoiceTimestamp[];
  adsbData: ADSBData[];
  recordings: AudioData[];
  recordingMeta?: Record<string, RecordingMeta>;
  currentTime: number;
  timelineMaxSec: number;
  selectedAircraft?: string;
  selectedTimestamp: VoiceTimestamp | null;
  visibleAircraftSet?: Set<string>;
  liveAdsbStatus?: {
    aircraft?: number;
    error?: string;
    stale?: boolean;
    lastDataAt?: number;
    activeWithinMinutes?: number;
  } | null;
}): AgentWorkspaceSnapshot {
  const {
    audioData,
    timestamps,
    adsbData,
    recordings,
    recordingMeta = {},
    currentTime,
    timelineMaxSec,
    selectedAircraft,
    selectedTimestamp,
    visibleAircraftSet,
    liveAdsbStatus,
  } = input;

  const visible =
    visibleAircraftSet && visibleAircraftSet.size > 0
      ? adsbData.filter((p) => visibleAircraftSet.has(p.icao24))
      : adsbData;

  const byIcao = new Map<string, ADSBData[]>();
  for (const p of visible) {
    const arr = byIcao.get(p.icao24) ?? [];
    arr.push(p);
    byIcao.set(p.icao24, arr);
  }

  const aircraftSample: AgentWorkspaceSnapshot["map"]["aircraftSample"] = [];
  for (const [icao24, points] of byIcao) {
    if (aircraftSample.length >= MAX_AIRCRAFT_SAMPLE) break;
    const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
    const livePoint = sorted.find((p) => p.live) ?? sorted[sorted.length - 1];
    const atPlayhead = nearestPointForTime(sorted.filter((p) => !p.live), currentTime) ?? livePoint;
    const p = atPlayhead ?? livePoint;
    if (!p) continue;
    aircraftSample.push({
      icao24,
      callsign: p.callsign,
      altitude: p.altitude,
      speed: p.speed,
      heading: p.heading,
      live: p.live,
    });
  }

  let selectedAircraftDetail: AgentWorkspaceSnapshot["map"]["selectedAircraftDetail"];
  if (selectedAircraft) {
    const pts = byIcao.get(selectedAircraft) ?? [];
    const sorted = [...pts].sort((a, b) => a.timestamp - b.timestamp);
    const latest = sorted[sorted.length - 1];
    if (latest) {
      selectedAircraftDetail = {
        icao24: selectedAircraft,
        callsign: latest.callsign,
        pointCount: sorted.length,
        latestAltitude: latest.altitude,
        latestSpeed: latest.speed,
      };
    }
  }

  const speakers = [
    ...new Set(timestamps.map((t) => t.speaker).filter((s): s is string => Boolean(s?.trim()))),
  ];
  const totalTextChars = timestamps.reduce((n, t) => n + (t.text?.length ?? 0), 0);

  return {
    generatedAt: new Date().toISOString(),
    recordings: recordings.map((r) => ({
      id: r.id,
      displayName: getRecordingDisplayName(r),
      durationSec: r.duration,
      segmentCount: r.timestamps?.length ?? 0,
      channel: recordingMeta[r.id]?.channel,
      icao: r.metadata?.icao,
      date: r.metadata?.date,
      isActive: r.id === audioData.id,
    })),
    activeRecording: {
      id: audioData.id,
      displayName: getRecordingDisplayName(audioData),
      durationSec: audioData.duration,
      metadata: audioData.metadata,
      transcript: truncateTranscript(timestamps, currentTime, selectedTimestamp?.id ?? null),
      transcriptStats: {
        segmentCount: timestamps.length,
        totalTextChars,
        speakers,
      },
    },
    playback: {
      currentTimeSec: currentTime,
      timelineMaxSec: timelineMaxSec,
    },
    map: {
      selectedAircraft,
      visibleAircraftCount: byIcao.size,
      liveAircraftCount: liveAdsbStatus?.aircraft,
      liveStale: liveAdsbStatus?.stale,
      liveError: liveAdsbStatus?.error,
      aircraftSample,
      selectedAircraftDetail,
    },
  };
}
