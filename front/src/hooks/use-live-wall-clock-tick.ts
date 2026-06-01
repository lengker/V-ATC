import { useEffect, useState } from "react";

/** 按墙钟采样航迹时定期触发重算（地图 RAF 不驱动 React 面板） */
export function useLiveWallClockTick(active: boolean, intervalMs = 1000) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
  return tick;
}
