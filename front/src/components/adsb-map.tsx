"use client";

// 纯前端 SVG 交互地图 - 支持缩放、拖拽、实时航迹、悬停信息弹窗、多视图

import { useEffect, useMemo, useRef, useState } from "react";
import { ADSBData } from "@/types";
import { formatTime } from "@/lib/utils";
import { buildInterpolatedTracks } from "@/lib/adsb-interpolation";
import type { VhhhStaticLayers } from "@/mock/vhhh-static";
import { deriveBoundsFromData } from "@/mock/vhhh-static";
import { Plane, ZoomIn, ZoomOut, Maximize2, Focus, LocateFixed } from "lucide-react";
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
    /** 计划航路 / 绕飞航路 */
    routes?: boolean;
    /** 天气等障碍多边形 */
    obstacles?: boolean;
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
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: 100, h: 100 });
  const [viewMode, setViewMode] = useState<"terrain" | "satellite">("terrain");
  const [hoveredAircraft, setHoveredAircraft] = useState<ADSBData | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const clampViewBox = (vb: { x: number; y: number; w: number; h: number }) => {
    const minW = 100 / 5; // 最大 5x
    const maxW = 100; // 最小 1x
    const w = Math.max(minW, Math.min(maxW, vb.w));
    const h = Math.max(minW, Math.min(maxW, vb.h));

    // 在最小缩放附近保留少量平移缓冲，避免“拖不动”的体感
    // 缩放越小（越接近 1x），缓冲越大；放大后自动收敛到边界内
    const loosenRatio = Math.max(0, (w - 70) / 30); // w: 70->100 映射到 0->1
    const panSlack = 8 * loosenRatio;
    const minX = -panSlack;
    const maxX = 100 - w + panSlack;
    const minY = -panSlack;
    const maxY = 100 - h + panSlack;

    const x = Math.max(minX, Math.min(maxX, vb.x));
    const y = Math.max(minY, Math.min(maxY, vb.y));
    return { x, y, w, h };
  };

  const zoomFactor = useMemo(() => Number((100 / viewBox.w).toFixed(2)), [viewBox.w]);

  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;

    setViewBox((prev) => {
      const nextW = prev.w / factor;
      const nextH = prev.h / factor;
      const focusX = prev.x + nx * prev.w;
      const focusY = prev.y + ny * prev.h;
      const nextX = focusX - nx * nextW;
      const nextY = focusY - ny * nextH;
      return clampViewBox({ x: nextX, y: nextY, w: nextW, h: nextH });
    });
  };

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
      const { minLat, maxLat, minLon, maxLon } = deriveBoundsFromData({
        adsb: [],
        statics: staticLayers,
      });
      return {
        filteredPoints: [] as ADSBData[],
        currentPoints: [] as ADSBData[],
        bounds: { minLat, maxLat, minLon, maxLon },
      };
    }

    const { minLat, maxLat, minLon, maxLon } = deriveBoundsFromData({ adsb: sane, statics: staticLayers });

    const isVisible = (icao24: string) =>
      !visibleAircraftSet || visibleAircraftSet.size === 0 || visibleAircraftSet.has(icao24);

    const { currentPoints, trailPoints } = buildInterpolatedTracks(sane, currentTime, isVisible);

    return {
      filteredPoints: trailPoints,
      currentPoints,
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

  const linePathD = (points: Array<{ lat: number; lon: number }>) => {
    if (points.length === 0) return "";
    return points
      .map(({ lat, lon }, idx) => {
        const { x, y } = project(lat, lon);
        return `${idx === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");
  };

  const closedPolygonD = (points: Array<{ lat: number; lon: number }>) => {
    if (points.length === 0) return "";
    return `${linePathD(points)} Z`;
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

  const trailSegments = useMemo(() => {
    const MAX_SEGMENTS = 180;
    const minAlpha = 0.12;
    const maxAlpha = 0.85;

    const blue = { r: 59, g: 130, b: 246 };
    const red = { r: 239, g: 68, b: 68 };

    const rgba = (c: { r: number; g: number; b: number }, a: number) =>
      `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.max(0, Math.min(1, a))})`;

    const { minLat, maxLat, minLon, maxLon } = bounds;
    const width = maxLon - minLon || 1;
    const height = maxLat - minLat || 1;
    const projectLocal = (lat: number, lon: number) => {
      const x = ((lon - minLon) / width) * 100;
      const y = (1 - (lat - minLat) / height) * 100;
      return { x, y };
    };

    return trails.map(({ icao24, pts }) => {
      const isSelected = icao24 === selectedAircraft;
      if (pts.length < 2) {
        return { icao24, isSelected, segments: [] as Array<{ d: string; stroke: string; strokeWidth: number }> };
      }

      const step = Math.max(1, Math.ceil((pts.length - 1) / MAX_SEGMENTS));
      const sampled: ADSBData[] = [];
      for (let i = 0; i < pts.length; i += step) sampled.push(pts[i]);
      if (sampled[sampled.length - 1] !== pts[pts.length - 1]) sampled.push(pts[pts.length - 1]);

      const n = sampled.length;
      const segments: Array<{ d: string; stroke: string; strokeWidth: number }> = [];
      const base = isSelected ? red : blue;
      const strokeWidth = isSelected ? 1.5 : 1;

      for (let i = 1; i < n; i++) {
        const a = minAlpha + ((maxAlpha - minAlpha) * i) / (n - 1);
        const p0 = sampled[i - 1];
        const p1 = sampled[i];
        const { x: x0, y: y0 } = projectLocal(p0.latitude, p0.longitude);
        const { x: x1, y: y1 } = projectLocal(p1.latitude, p1.longitude);
        segments.push({
          d: `M ${x0} ${y0} L ${x1} ${y1}`,
          stroke: rgba(base, a),
          strokeWidth,
        });
      }

      return { icao24, isSelected, segments };
    });
  }, [bounds, selectedAircraft, trails]);

  const show = {
    runways: toggles?.runways ?? true,
    taxiways: toggles?.taxiways ?? true,
    waypoints: toggles?.waypoints ?? true,
    landmarks: toggles?.landmarks ?? true,
    trails: toggles?.trails ?? true,
    routes: toggles?.routes ?? true,
    obstacles: toggles?.obstacles ?? true,
  };

  const routeLinesSorted = useMemo(() => {
    const list = staticLayers?.routeLines ?? [];
    const order: Record<string, number> = { planned: 0, detour: 1, missed: 2 };
    return [...list].sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
  }, [staticLayers?.routeLines]);

  const selectedCurrentPoint = useMemo(
    () => currentPoints.find((p) => p.icao24 === selectedAircraft),
    [currentPoints, selectedAircraft]
  );

  const setViewBoxByPoints = (points: Array<{ x: number; y: number }>) => {
    if (points.length === 0) return;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.max(0, Math.min(...xs));
    const maxX = Math.min(100, Math.max(...xs));
    const minY = Math.max(0, Math.min(...ys));
    const maxY = Math.min(100, Math.max(...ys));

    // 保留一定边距，并保证至少能看到周边环境（非针尖视角）
    const padding = 6;
    const spanX = Math.max(18, maxX - minX);
    const spanY = Math.max(18, maxY - minY);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const width = spanX + padding * 2;
    const height = spanY + padding * 2;

    setViewBox(clampViewBox({ x: centerX - width / 2, y: centerY - height / 2, w: width, h: height }));
  };

  const handleFitVisible = () => {
    const all: Array<{ x: number; y: number }> = [];
    for (const p of filteredPoints) {
      all.push(project(p.latitude, p.longitude));
    }
    setViewBoxByPoints(all);
  };

  const handleFocusSelected = () => {
    if (!selectedCurrentPoint) return;
    const pt = project(selectedCurrentPoint.latitude, selectedCurrentPoint.longitude);
    setViewBoxByPoints([pt]);
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

    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dxPx = e.clientX - dragStartRef.current.x;
    const dyPx = e.clientY - dragStartRef.current.y;
    const dx = (dxPx / rect.width) * viewBox.w;
    const dy = (dyPx / rect.height) * viewBox.h;

    setViewBox((prev) => clampViewBox({ ...prev, x: prev.x - dx, y: prev.y - dy }));

    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  // 鼠标抬起 - 停止拖拽
  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  // 鼠标滚轮 - 缩放
  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const factor = e.deltaY > 0 ? 1 / 1.2 : 1.2;
    zoomAt(e.clientX, e.clientY, factor);
  };

  // 用非 passive 的原生 wheel 监听，确保滚轮不会带动页面滚动
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (ev: WheelEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      const factor = ev.deltaY > 0 ? 1 / 1.2 : 1.2;
      zoomAt(ev.clientX, ev.clientY, factor);
    };
    svg.addEventListener("wheel", handler, { passive: false });
    return () => svg.removeEventListener("wheel", handler as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 重置视图
  const handleResetView = () => {
    setViewBox({ x: 0, y: 0, w: 100, h: 100 });
  };

  // 缩放按钮处理
  const handleZoomIn = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.2);
  };
  const handleZoomOut = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / 1.2);
  };

  return (
    <div className="w-full h-full rounded-lg border bg-muted/20 flex flex-col">
      {/* 顶部工具栏 */}
      <div className="px-3 py-2 border-b flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-foreground">🗺️ ADSB 实时航迹地图</span>
          <span className="text-muted-foreground hidden sm:inline">
            航路 · 障碍区 · 绕飞
          </span>
          <span className="text-muted-foreground">
            t={formatTime(currentTime || 0)}
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
            onClick={handleFitVisible}
            className="h-8 w-8 hover:bg-primary/30"
            title="适配当前可见航迹"
          >
            <Focus className="h-4 w-4" />
          </Button>
          <div className="h-0.5 bg-border/30 mx-2" />
          <Button
            variant="ghost"
            size="icon"
            onClick={handleFocusSelected}
            className="h-8 w-8 hover:bg-primary/30"
            title="聚焦选中目标"
            disabled={!selectedCurrentPoint}
          >
            <LocateFixed className="h-4 w-4" />
          </Button>
          <div className="h-0.5 bg-border/30 mx-2" />
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
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
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
          <g>
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

            {/* 障碍 / 受限区（示意多边形） */}
            {show.obstacles &&
              (staticLayers?.obstacleZones ?? []).map((z) => {
                const fill =
                  z.kind === "weather"
                    ? "rgba(249, 115, 22, 0.2)"
                    : z.kind === "nfz"
                      ? "rgba(239, 68, 68, 0.18)"
                      : "rgba(120, 113, 108, 0.2)";
                const stroke =
                  z.kind === "weather"
                    ? "rgba(251, 146, 60, 0.75)"
                    : z.kind === "nfz"
                      ? "rgba(248, 113, 113, 0.85)"
                      : "rgba(168, 162, 158, 0.7)";
                const d = closedPolygonD(z.polygon);
                const cLat = z.polygon.reduce((s, p) => s + p.lat, 0) / z.polygon.length;
                const cLon = z.polygon.reduce((s, p) => s + p.lon, 0) / z.polygon.length;
                const { x: lx, y: ly } = project(cLat, cLon);
                return (
                  <g key={z.id}>
                    <path d={d} fill={fill} stroke={stroke} strokeWidth={0.35} strokeDasharray="1 0.6" />
                    <text
                      x={lx}
                      y={ly}
                      fontSize="2"
                      fill="rgba(254, 215, 170, 0.95)"
                      textAnchor="middle"
                      style={{ pointerEvents: "none" }}
                    >
                      {z.name}
                    </text>
                  </g>
                );
              })}

            {/* 计划航路 / 绕飞航路 */}
            {show.routes &&
              routeLinesSorted.map((route) => {
                const d = linePathD(route.points);
                if (!d) return null;
                const isDetour = route.kind === "detour";
                const isMissed = route.kind === "missed";
                const stroke = isDetour
                  ? "rgba(232, 121, 249, 0.95)"
                  : isMissed
                    ? "rgba(251, 191, 36, 0.9)"
                    : "rgba(34, 211, 238, 0.88)";
                const strokeW = isDetour ? 1.35 : isMissed ? 1.1 : 0.95;
                const dash = isDetour ? "1.8 1.1" : isMissed ? "2 1.2" : "2.2 1.4";
                const p0 = route.points[0];
                const pLast = route.points[route.points.length - 1];
                const { x: tx, y: ty } = project(p0.lat, p0.lon);
                const { x: ex, y: ey } = project(pLast.lat, pLast.lon);
                // 计划线与绕飞线终点常重合，绕飞标记略偏移以免完全叠盖
                const nudgeX = isDetour ? 0.65 : 0;
                const nudgeY = isDetour ? -0.45 : 0;
                const mx = ex + nudgeX;
                const my = ey + nudgeY;
                const endCaption =
                  route.endLabel ??
                  `${pLast.lat.toFixed(3)}°, ${pLast.lon.toFixed(3)}°`;
                return (
                  <g key={route.id}>
                    <path
                      d={d}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={strokeW}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray={dash}
                      opacity={0.92}
                    />
                    <text
                      x={tx + 1.2}
                      y={ty - 1}
                      fontSize="2"
                      fill={stroke}
                      fontWeight="600"
                      style={{ pointerEvents: "none" }}
                    >
                      {route.name}
                      {isDetour ? " · 绕飞" : ""}
                    </text>
                    {/* 终点：菱形标记 + 终点名 / 坐标 */}
                    <g style={{ pointerEvents: "none" }}>
                      <path
                        d={`M ${mx} ${my - 1.4} L ${mx + 1.1} ${my} L ${mx} ${my + 1.4} L ${mx - 1.1} ${my} Z`}
                        fill={stroke}
                        stroke="rgba(255,255,255,0.85)"
                        strokeWidth={0.15}
                        opacity={0.95}
                      />
                      <text
                        x={mx}
                        y={my - 2.2}
                        fontSize="1.85"
                        fill="rgba(248, 250, 252, 0.95)"
                        fontWeight="700"
                        textAnchor="middle"
                      >
                        终点
                      </text>
                      <text
                        x={mx}
                        y={my + 3.2}
                        fontSize="1.75"
                        fill={stroke}
                        fontWeight="600"
                        textAnchor="middle"
                      >
                        {endCaption}
                      </text>
                    </g>
                  </g>
                );
              })}

            {/* 航迹线 - 历史尾迹（颜色渐变：旧->新逐渐更亮） */}
            {show.trails &&
              trailSegments.map(({ icao24, segments }) => (
                <g key={icao24} style={{ pointerEvents: "none" }}>
                  {segments.map((seg, idx) => (
                    <path
                      key={`${icao24}-${idx}`}
                      d={seg.d}
                      fill="none"
                      stroke={seg.stroke}
                      strokeWidth={seg.strokeWidth}
                      strokeLinecap="round"
                      className="animate-flow"
                      strokeDasharray="2 1"
                    />
                  ))}
                </g>
              ))}

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

        {/* 飞机信息弹窗 - 悬停显示（右下角，避免与左下角图例重叠） */}
        {hoveredAircraft && (
          <Card className="absolute bottom-4 right-4 p-3 bg-black/90 border-primary/40 text-white text-xs max-w-[min(18rem,calc(100%-2rem))] z-30 backdrop-blur-md shadow-xl ring-1 ring-white/10">
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

        {/* 图例：固定左下，z 低于飞机悬停卡 */}
        <div className="absolute bottom-3 left-4 bg-black/40 backdrop-blur-sm rounded px-2 py-1.5 text-[10px] text-muted-foreground/85 z-10 border border-border/30 max-w-[10.5rem] pointer-events-none">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-0.5 bg-cyan-400/90 rounded" style={{ borderStyle: "dashed" }} />
              <span>计划航路</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-0.5 bg-fuchsia-400/90 rounded" />
              <span>绕飞航路</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-sm bg-orange-400/50 border border-orange-300/60" />
              <span>障碍区</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
              <span>ADSB 航迹</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 bg-amber-500 rounded-full" />
              <span>地标</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
              <span>航路点</span>
            </div>
          </div>
        </div>

        {/* 观察态 HUD */}
        <div className="absolute top-4 left-4 bg-black/45 backdrop-blur-sm rounded px-2 py-1 text-xs text-muted-foreground border border-border/30">
          <div className="font-mono">{zoomFactor.toFixed(1)}x</div>
          <div>{currentPoints.length} targets</div>
          <div>{filteredPoints.length} pts</div>
          {selectedCurrentPoint ? (
            <div className="text-cyan-300 max-w-[11rem] truncate">
              SEL: {selectedCurrentPoint.callsign || selectedCurrentPoint.icao24}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
