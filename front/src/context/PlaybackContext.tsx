"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type PlaybackTimeSource = "waveform" | "ui" | "system";

export type PlaybackContextValue = {
  currentTime: number;
  timelineMax: number;
  audioDuration: number | null;
  setCurrentTime: (t: number, source?: PlaybackTimeSource) => void;
  setAudioDuration: (d: number) => void;
};

const PlaybackContext = createContext<PlaybackContextValue | undefined>(undefined);

function clamp(v: number, min: number, max: number) {
  if (Number.isNaN(v)) return min;
  return Math.max(min, Math.min(max, v));
}

export function PlaybackProvider({
  children,
  timelineMax,
  initialTime = 0,
}: {
  children: React.ReactNode;
  timelineMax: number;
  initialTime?: number;
}) {
  const [audioDuration, _setAudioDuration] = useState<number | null>(null);

  const resolveMax = useCallback(
    (dur: number | null) => Math.max(timelineMax || 0, dur ?? 0, 1),
    [timelineMax]
  );

  const [currentTime, _setCurrentTime] = useState(() =>
    clamp(initialTime, 0, resolveMax(null))
  );

  const timelineMaxRef = useRef(resolveMax(audioDuration));

  useEffect(() => {
    timelineMaxRef.current = resolveMax(audioDuration);
    _setCurrentTime((t) => clamp(t, 0, timelineMaxRef.current));
  }, [audioDuration, resolveMax]);

  const setCurrentTime = useCallback((t: number, _source?: PlaybackTimeSource) => {
    if (Number.isFinite(t) && t > timelineMaxRef.current) {
      timelineMaxRef.current = t;
    }
    _setCurrentTime(clamp(t, 0, Math.max(0, timelineMaxRef.current || 0)));
  }, []);

  const setAudioDuration = useCallback((d: number) => {
    if (!Number.isFinite(d) || d <= 0) return;
    _setAudioDuration((prev) => {
      if (prev != null && Math.abs(prev - d) < 0.01) return prev;
      return d;
    });
    if (d > timelineMaxRef.current) {
      timelineMaxRef.current = d;
    }
  }, []);

  const effectiveTimelineMax = resolveMax(audioDuration);

  const value = useMemo(
    () => ({
      currentTime,
      timelineMax: effectiveTimelineMax,
      audioDuration,
      setCurrentTime,
      setAudioDuration,
    }),
    [currentTime, effectiveTimelineMax, audioDuration, setCurrentTime, setAudioDuration]
  );

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

export function usePlayback() {
  const ctx = useContext(PlaybackContext);
  if (!ctx) throw new Error("usePlayback must be used within PlaybackProvider");
  return ctx;
}

export function usePlaybackOptional() {
  return useContext(PlaybackContext);
}
