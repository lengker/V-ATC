"use client";

// 纯前端 SVG 交互地图 - 支持缩放、拖拽、实时航迹、悬停信息弹窗、多视图

import { useMemo, useState, useRef } from "react";
import { ADSBData } from "@/types";
import { formatTime } from "@/lib/utils";
import type { VhhhStaticLayers } from "@/mock/vhhh-static";
import { deriveBoundsFromData } from "@/mock/vhhh-static";
import { Plane, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

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
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [viewMode, setViewMode] = useState<"terrain" | "satellite">("terrain");
  const [hoveredAircraft, setHoveredAircraft] = useState<ADSBData | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  // 归一化坐标到 [0,1]，然后映射到 SVG
  const { filteredPoints, currentPoints, bounds } = useMemo(() => {
    const sane = adsbData.filter(
      (p) =>
        Number.isFinite(p.latitude) &&
        Number.isFinite(p.longitude) &&
        // 纬度[-90,90] 经度[-180,180]
        Math.abs(p.latitude) <= 90 &&
        Math.abs(p.longitude) <= 180 &&
        Number.isFinite(p.timestamp)
    );

    if (sane.length === 0) {
      return {
        filteredPoints: [] as ADSBData[],
        currentPoints: [] as ADSBData[],
        bounds: { minLat: 0, maxLat: 1, minLon: 0, maxLon: 1 },
      };
    }

    const { minLat, maxLat, minLon, maxLon } = deriveBoundsFromData({ adsb: sane, statics: staticLayers });

    const filtered = sane.filter((p) => {
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
    const y = (1 - (lat - minLat) / height) * 100;
    return { x, y };
  };

  // 构造每架飞机的折线
  const trails = useMemo(() => {
    const byAircraft: Record<string, ADSBData[]> = {};
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

  // 应用缩放和平移变换
  const getTransform = () => {
    const centerX = 50;
    const centerY = 50;
    return `translate(${pan.x}, ${pan.y}) scale(${zoom}) translate(${centerX * (1 - zoom)}, ${centerY * (1 - zoom)})`;
  };

  // 鼠标按下 - 开始拖拽
  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    // 点击飞机点位/信息时，不开启拖拽，避免影响点选
    if (e.target instanceof Element && e.target.closest("[data-aircraft]")) {
      return;
    }
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  // 鼠标移动 - 平移
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDraggingRef.current) return;

    const dx = (e.clientX - dragStartRef.current.x) / zoom;
    const dy = (e.clientY - dragStartRef.current.y) / zoom;

    setPan((prev) => ({
      x: prev.x + dx,
      y: prev.y + dy,
    }));

    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  // 鼠标抬起 - 停止拖拽
  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  // 鼠标滚轮 - 缩放
  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.8 : 1.2;
    setZoom((prev) => Math.max(1, Math.min(prev * delta, 5)));
  };

  // 重置视图
  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // 缩放按钮处理
  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.5, 5));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.5, 1));

  return (
    <div className="w-full h-full rounded-lg border bg-muted/20 flex flex-col">
      {/* 顶部工具栏 */}
      <div className="px-3 py-2 border-b flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-foreground">🗺️ ADSB 实时航迹地图</span>
          <span className="text-muted-foreground">
            当前时间: {formatTime(currentTime || 0)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === "terrain" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("terrain")}
            className="text-xs h-7"
          >
            🌍 地形
          </Button>
          <Button
            variant={viewMode === "satellite" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("satellite")}
            className="text-xs h-7"
          >
            🛰️ 卫星
          </Button>
        </div>
      </div>

      {/* 地图容器 */}
      <div className="flex-1 relative overflow-hidden bg-gradient-to-br from-slate-900 to-slate-800">
        {/* 缩放控制 */}
        <div className="absolute top-4 right-4 flex flex-col gap-1 z-10 bg-black/40 backdrop-blur-sm rounded-lg p-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleZoomIn}
            className="h-8 w-8 hover:bg-primary/30"
            title="放大 (滚轮也可缩放)"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <div className="h-0.5 bg-border/30 mx-2" />
          <Button
            variant="ghost"
            size="icon"
            onClick={handleZoomOut}
            className="h-8 w-8 hover:bg-primary/30"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <div className="h-0.5 bg-border/30 mx-2" />
          <Button
            variant="ghost"
            size="icon"
            onClick={handleResetView}
            className="h-8 w-8 hover:bg-primary/30"
            title="重置视图"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>

        {/* SVG 地图 */}
        <svg
          ref={svgRef}
          viewBox="0 0 100 100"
          className="w-full h-full cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          style={{ userSelect: "none" }}
        >
          <defs>
            {/* 网格背景 */}
            <pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse">
              <path
                d="M 5 0 L 0 0 0 5"
                fill="none"
                stroke={viewMode === "satellite" ? "rgba(100,100,100,0.2)" : "rgba(148,163,184,0.3)"}
                strokeWidth="0.15"
              />
            </pattern>

            {/* 流动航迹动画 */}
            <style>{`
              @keyframes flowDash {
                to { stroke-dashoffset: -10; }
              }
              .animate-flow { animation: flowDash 2s linear infinite; }
              @keyframes pulse {
                0%, 100% { r: 2.5; opacity: 0.4; }
                50% { r: 4; opacity: 0.1; }
              }
              .animate-pulse-ring { animation: pulse 2s infinite; }
            `}</style>
          </defs>

          {/* 背景层 */}
          <g transform={getTransform()}>
            <rect width="100" height="100" fill={viewMode === "satellite" ? "#1a1a2e" : "#0f172a"} />
            <rect width="100" height="100" fill="url(#grid)" opacity={viewMode === "satellite" ? 0.3 : 0.5} />

            {/* 跑道 */}
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
                    stroke={viewMode === "satellite" ? "rgba(255,200,100,0.9)" : "rgba(255,255,255,0.85)"}
                    strokeWidth={2}
                    strokeLinecap="round"
                    opacity={0.9}
                  />
                );
              })}

            {/* 滑行道 */}
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
                    stroke={viewMode === "satellite" ? "rgba(100,200,255,0.7)" : "rgba(56,189,248,0.8)"}
                    strokeWidth={0.9}
                    strokeDasharray="1.2 0.8"
                    opacity={0.8}
                  />
                );
              })}

            {/* 航迹线 - 带流动动画 */}
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
                    strokeWidth={isSelected ? 1.5 : 1}
                    opacity={0.6}
                    strokeLinecap="round"
                    className="animate-flow"
                    strokeDasharray="2 1"
                  />
                );
              })}

            {/* 航路点 */}
            {show.waypoints &&
              (staticLayers?.waypoints ?? []).map((wp) => {
                const { x, y } = project(wp.lat, wp.lon);
                return (
                  <g key={wp.id}>
                    <circle cx={x} cy={y} r={0.8} fill="rgba(34,197,94,0.9)" opacity={0.7} />
                    <circle cx={x} cy={y} r={1.3} fill="none" stroke="rgba(34,197,94,0.5)" strokeWidth={0.4} />
                    <text x={x + 1.6} y={y - 1} fontSize="2.2" fill="rgba(226,232,240,0.85)" fontWeight="bold">
                      {wp.name}
                    </text>
                  </g>
                );
              })}

            {/* 地标 */}
            {show.landmarks &&
              (staticLayers?.landmarks ?? []).map((lm) => {
                const { x, y } = project(lm.lat, lm.lon);
                return (
                  <g key={lm.id} opacity={0.85}>
                    <circle cx={x} cy={y} r={1.2} fill="rgba(251,191,36,0.9)" />
                    <circle cx={x} cy={y} r={1.8} fill="none" stroke="rgba(251,191,36,0.4)" strokeWidth={0.5} />
                    <text x={x + 2} y={y + 2.5} fontSize="2.2" fill="rgba(226,232,240,0.9)" fontWeight="bold">
                      {lm.name}
                    </text>
                  </g>
                );
              })}

            {/* 当前飞机位置 */}
            {currentPoints.map((p) => {
              const { x, y } = project(p.latitude, p.longitude);
              const isSelected = p.icao24 === selectedAircraft;
              const isHovered = hoveredAircraft?.icao24 === p.icao24;

              return (
                <g
                  key={p.icao24}
                  data-aircraft={p.icao24}
                  onClick={() => onAircraftSelect?.(p.icao24)}
                  onMouseEnter={() => setHoveredAircraft(p)}
                  onMouseLeave={() => setHoveredAircraft(null)}
                  style={{ cursor: "pointer", pointerEvents: "auto" }}
                >
                  {/* 光晕效果 */}
                  {(isSelected || isHovered) && (
                    <circle
                      cx={x}
                      cy={y}
                      r={3}
                      fill="none"
                      stroke={isSelected ? "#ef4444" : "#0ea5e9"}
                      strokeWidth={0.6}
                      opacity={0.4}
                      className="animate-pulse-ring"
                    />
                  )}

                  {/* 飞机图标 */}
                  <g transform={`translate(${x} ${y})`}>
                    <circle
                      cx="0"
                      cy="0"
                      r={isSelected ? 1.2 : 1}
                      fill={isSelected ? "#ef4444" : "#0ea5e9"}
                      opacity={0.9}
                    />
                    <polygon
                      points="0,-1.8 1.2,1.2 0,0.3 -1.2,1.2"
                      fill={isSelected ? "#fbbf24" : "#ffffff"}
                      opacity={0.8}
                      transform={`rotate(${p.heading || 0})`}
                    />
                  </g>
                </g>
              );
            })}
          </g>
        </svg>

        {/* 飞机信息弹窗 - 悬停显示 */}
        {hoveredAircraft && (
          <Card className="absolute bottom-4 left-4 p-3 bg-black/85 border-primary/40 text-white text-xs max-w-sm z-20 backdrop-blur-sm shadow-lg">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 font-bold text-sm border-b border-primary/30 pb-1.5">
                <Plane className="h-4 w-4 text-cyan-400" />
                {hoveredAircraft.callsign || `ICAO: ${hoveredAircraft.icao24}`}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                <div className="text-muted-foreground/80">
                  <span className="text-xs">高度</span>
                  <div className="text-cyan-300 font-mono">{hoveredAircraft.altitude?.toLocaleString() || "—"} ft</div>
                </div>
                <div className="text-muted-foreground/80">
                  <span className="text-xs">速度</span>
                  <div className="text-cyan-300 font-mono">{hoveredAircraft.speed?.toFixed(0) || "—"} kts</div>
                </div>
                <div className="text-muted-foreground/80">
                  <span className="text-xs">航向</span>
                  <div className="text-cyan-300 font-mono">{hoveredAircraft.heading || "—"}°</div>
                </div>
                <div className="text-muted-foreground/80">
                  <span className="text-xs">爬升率</span>
                  <div className="text-cyan-300 font-mono">{hoveredAircraft.verticalRate || "—"} f/m</div>
                </div>
              </div>
              <div className="text-muted-foreground/70 text-xs border-t border-primary/30 pt-1.5 font-mono">
                📍 {hoveredAircraft.latitude.toFixed(4)}, {hoveredAircraft.longitude.toFixed(4)}
              </div>
            </div>
          </Card>
        )}

        {/* 图例 - 超小透明版 */}
        <div className="absolute bottom-3 left-4 bg-black/30 backdrop-blur-sm rounded px-2 py-1.5 text-xs text-muted-foreground/70 z-20 border border-border/20">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
              <span className="text-[10px]">航迹</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 bg-amber-500 rounded-full" />
              <span className="text-[10px]">地标</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
              <span className="text-[10px]">航路点</span>
            </div>
          </div>
        </div>

        {/* 缩放指示 */}
        <div className="absolute top-4 left-4 bg-black/40 backdrop-blur-sm rounded px-2 py-1 text-xs text-muted-foreground">
          {zoom.toFixed(1)}x
        </div>
      </div>
    </div>
  );
}
