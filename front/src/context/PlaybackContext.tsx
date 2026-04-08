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
  const [currentTime, _setCurrentTime] = useState(() => clamp(initialTime, 0, Math.max(0, timelineMax || 0)));
  const [audioDuration, _setAudioDuration] = useState<number | null>(null);

  const timelineMaxRef = useRef(timelineMax);
  useEffect(() => {
    timelineMaxRef.current = timelineMax;
    // timelineMax 变化时，确保 currentTime 不越界
    _setCurrentTime((t) => clamp(t, 0, Math.max(0, timelineMax)));
  }, [timelineMax]);

  const setCurrentTime = useCallback((t: number, _source?: PlaybackTimeSource) => {
    _setCurrentTime(clamp(t, 0, Math.max(0, timelineMaxRef.current || 0)));
  }, []);

  const setAudioDuration = useCallback((d: number) => {
    _setAudioDuration((prev) => {
      if (!Number.isFinite(d) || d <= 0) return prev;
      if (prev != null && Math.abs(prev - d) < 0.01) return prev;
      return d;
    });
  }, []);

  const value = useMemo(
    () => ({
      currentTime,
      timelineMax,
      audioDuration,
      setCurrentTime,
      setAudioDuration,
    }),
    [currentTime, timelineMax, audioDuration, setCurrentTime, setAudioDuration]
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
