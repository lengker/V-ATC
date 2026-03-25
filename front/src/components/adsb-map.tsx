"use client";

// 为了避免 Leaflet 在开发模式下频繁报 “Map container is already initialized”，
// 这里先用一个纯前端 SVG“简易地图”来可视化航迹。
// 等你们后端和部署环境稳定后，如果需要换回真正的地图，可以再接入 Leaflet 或 Mapbox。

import { useMemo } from "react";
import { ADSBData } from "@/types";
import { formatTime } from "@/lib/utils";
import type { VhhhStaticLayers } from "@/mock/vhhh-static";
import { deriveBoundsFromData } from "@/mock/vhhh-static";

interface ADSBMapProps {
  adsbData: ADSBData[];
  visibleAircraftSet?: Set<string>;
  staticLayers?: VhhhStaticLayers;
  toggles?: {
    runways?: boolean;
    taxiways?: boolean;
    waypoints?: boolean;
    landmarks?: boolean;
    trails?: boolean;
  };
  currentTime?: number;
  selectedAircraft?: string;
  onAircraftSelect?: (icao24: string) => void;
}

export function ADSBMap({
  adsbData,
  visibleAircraftSet,
  staticLayers,
  toggles,
  currentTime = 0,
  selectedAircraft,
  onAircraftSelect,
}: ADSBMapProps) {
  // 归一化坐标到 [0,1]，然后映射到 SVG
  const { points, filteredPoints, currentPoints, bounds } = useMemo(() => {
    if (adsbData.length === 0) {
      return {
        points: [] as ADSBData[],
        filteredPoints: [] as ADSBData[],
        currentPoints: [] as ADSBData[],
        bounds: { minLat: 0, maxLat: 1, minLon: 0, maxLon: 1 },
      };
    }

    const { minLat, maxLat, minLon, maxLon } = deriveBoundsFromData({ adsb: adsbData, statics: staticLayers });

    const filtered = adsbData.filter((p) => {
      const timeOk = p.timestamp <= currentTime;
      const targetOk = !visibleAircraftSet || visibleAircraftSet.size === 0 || visibleAircraftSet.has(p.icao24);
      return timeOk && targetOk;
    });

    // 每架飞机当前点
    const byAircraft: Record<string, ADSBData[]> = {};
    for (const p of filtered) {
      if (!byAircraft[p.icao24]) byAircraft[p.icao24] = [];
      byAircraft[p.icao24].push(p);
    }
    const current: ADSBData[] = Object.values(byAircraft).map((arr) =>
      arr.sort((a, b) => a.timestamp - b.timestamp)[arr.length - 1]
    );

    return {
      points: adsbData.filter((p) => !visibleAircraftSet || visibleAircraftSet.size === 0 || visibleAircraftSet.has(p.icao24)),
      filteredPoints: filtered,
      currentPoints: current,
      bounds: { minLat, maxLat, minLon, maxLon },
    };
  }, [adsbData, currentTime, staticLayers, visibleAircraftSet]);

  const project = (lat: number, lon: number) => {
    const { minLat, maxLat, minLon, maxLon } = bounds;
    const width = maxLon - minLon || 1;
    const height = maxLat - minLat || 1;
    const x = ((lon - minLon) / width) * 100;
    const y = (1 - (lat - minLat) / height) * 100; // y 轴反转
    return { x, y };
  };

  // 构造每架飞机的折线
  const trails = useMemo(() => {
    const byAircraft: Record<string, ADSBData[]> = {};
    // 关键：航迹按 currentTime 截断，实现“时间漫游”
    for (const p of filteredPoints) {
      if (!byAircraft[p.icao24]) byAircraft[p.icao24] = [];
      byAircraft[p.icao24].push(p);
    }
    return Object.entries(byAircraft).map(([icao24, pts]) => ({
      icao24,
      pts: pts.sort((a, b) => a.timestamp - b.timestamp),
    }));
  }, [filteredPoints]);

  const show = {
    runways: toggles?.runways ?? true,
    taxiways: toggles?.taxiways ?? true,
    waypoints: toggles?.waypoints ?? true,
    landmarks: toggles?.landmarks ?? true,
    trails: toggles?.trails ?? true,
  };

  return (
    <div className="w-full h-full rounded-lg border bg-muted/20 flex flex-col">
      <div className="px-3 py-2 border-b flex items-center justify-between text-xs text-muted-foreground">
        <span>ADSB 航迹示意图（SVG 简易版）</span>
        <span>
          当前时间：
          {formatTime(currentTime || 0)}
        </span>
      </div>
      <div className="flex-1 relative">
        <svg viewBox="0 0 100 100" className="w-full h-full">
          {/* 背景网格 */}
          <defs>
            <pattern
              id="grid"
              width="10"
              height="10"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 10 0 L 0 0 0 10"
                fill="none"
                stroke="rgba(148, 163, 184, 0.3)"
                strokeWidth="0.2"
              />
            </pattern>
          </defs>
          <rect width="100" height="100" fill="url(#grid)" />

          {/* 静态图层：跑道/滑行道 */}
          {show.runways &&
            (staticLayers?.runways ?? []).map((rw) => {
              const d = rw.points
                .map(({ lat, lon }, idx) => {
                  const { x, y } = project(lat, lon);
                  return `${idx === 0 ? "M" : "L"} ${x} ${y}`;
                })
                .join(" ");
              return (
                <path
                  key={rw.id}
                  d={d}
                  fill="none"
                  stroke="rgba(255,255,255,0.85)"
                  strokeWidth={2.0}
                  strokeLinecap="round"
                  opacity={0.9}
                />
              );
            })}

          {show.taxiways &&
            (staticLayers?.taxiways ?? []).map((twy) => {
              const d = twy.points
                .map(({ lat, lon }, idx) => {
                  const { x, y } = project(lat, lon);
                  return `${idx === 0 ? "M" : "L"} ${x} ${y}`;
                })
                .join(" ");
              return (
                <path
                  key={twy.id}
                  d={d}
                  fill="none"
                  stroke="rgba(56,189,248,0.8)"
                  strokeWidth={0.9}
                  strokeDasharray="1.2 0.8"
                  opacity={0.9}
                />
              );
            })}

          {/* 航迹线 */}
          {show.trails &&
            trails.map(({ icao24, pts }) => {
            const d = pts
              .map(({ latitude, longitude }, idx) => {
                const { x, y } = project(latitude, longitude);
                return `${idx === 0 ? "M" : "L"} ${x} ${y}`;
              })
              .join(" ");

            const isSelected = icao24 === selectedAircraft;

            return (
              <path
                key={icao24}
                d={d}
                fill="none"
                stroke={isSelected ? "#ef4444" : "#3b82f6"}
                strokeWidth={isSelected ? 1.2 : 0.8}
                opacity={0.7}
              />
            );
          })}

          {/* 当前飞机位置 */}
          {currentPoints.map((p) => {
            const { x, y } = project(p.latitude, p.longitude);
            const isSelected = p.icao24 === selectedAircraft;
            return (
              <g
                key={p.icao24}
                onClick={() => onAircraftSelect?.(p.icao24)}
                style={{ cursor: "pointer" }}
              >
                <circle
                  cx={x}
                  cy={y}
                  r={isSelected ? 1.6 : 1.2}
                  fill={isSelected ? "#ef4444" : "#0ea5e9"}
                  stroke="white"
                  strokeWidth={0.3}
                />
              </g>
            );
          })}

          {/* 航路点/地标 */}
          {show.waypoints &&
            (staticLayers?.waypoints ?? []).map((wp) => {
              const { x, y } = project(wp.lat, wp.lon);
              return (
                <g key={wp.id}>
                  <rect x={x - 0.9} y={y - 0.9} width={1.8} height={1.8} fill="rgba(34,197,94,0.9)" />
                  <text x={x + 1.4} y={y - 1.2} fontSize="2.6" fill="rgba(226,232,240,0.9)">
                    {wp.name}
                  </text>
                </g>
              );
            })}

          {show.landmarks &&
            (staticLayers?.landmarks ?? []).map((lm) => {
              const { x, y } = project(lm.lat, lm.lon);
              return (
                <g key={lm.id} opacity={0.9}>
                  <circle cx={x} cy={y} r={1.0} fill="rgba(251,191,36,0.95)" />
                  <text x={x + 1.4} y={y + 2.2} fontSize="2.6" fill="rgba(226,232,240,0.85)">
                    {lm.name}
                  </text>
                </g>
              );
            })}
        </svg>
      </div>
    </div>
  );
}
