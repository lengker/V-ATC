import type { ADSBData } from "@/types";

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

/** 计划或绕飞航路折线（示意，可对接 A-5 / AIP 航路数据） */
export type RoutePolyline = {
  id: string;
  name: string;
  /** planned=申报/标准线；detour=遇障后的改航段；missed=复飞等 */
  kind: "planned" | "detour" | "missed";
  points: Array<{ lat: number; lon: number }>;
  note?: string;
  /** 地图终点标注（如航路点、走廊名）；缺省时仅显示几何终点 */
  endLabel?: string;
};

/** 障碍或受限空域（天气胞、临时禁飞区等），用多边形近似 */
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
  /** 航路可视化：计划线 + 绕飞线 */
  routeLines?: RoutePolyline[];
  /** 障碍区可视化 */
  obstacleZones?: ObstacleZone[];
};

// 说明：
// - 这里是“示意级”静态数据，只用于把前端 UI/交互跑通。
// - 后续你们 A-5 模块接入正式 AIP/VSP 数据后，用真实数据替换即可。
export const vhhhStatic: VhhhStaticLayers = {
  runways: [
    {
      id: "07L-25R",
      name: "RWY 07L/25R",
      kind: "runway",
      points: [
        { lat: 22.3151, lon: 113.9363 },
        { lat: 22.2962, lon: 113.9363 },
      ],
      note: "示意线（非精确）",
    },
    {
      id: "07R-25L",
      name: "RWY 07R/25L",
      kind: "runway",
      points: [
        { lat: 22.3149, lon: 113.9255 },
        { lat: 22.2960, lon: 113.9255 },
      ],
      note: "示意线（非精确）",
    },
  ],
  taxiways: [
    {
      id: "TWY-A",
      name: "TWY A",
      kind: "taxiway",
      points: [
        { lat: 22.307, lon: 113.9265 },
        { lat: 22.307, lon: 113.9355 },
      ],
    },
    {
      id: "TWY-B",
      name: "TWY B",
      kind: "taxiway",
      points: [
        { lat: 22.305, lon: 113.9265 },
        { lat: 22.305, lon: 113.9355 },
      ],
    },
  ],
  waypoints: [
    { id: "SOKOE", name: "SOKOE", kind: "waypoint", lat: 22.542, lon: 114.135 },
    { id: "TAMOT", name: "TAMOT", kind: "waypoint", lat: 22.480, lon: 113.860 },
    { id: "BEKOL", name: "BEKOL", kind: "waypoint", lat: 22.460, lon: 114.360 },
  ],
  landmarks: [
    { id: "LANTAU", name: "Lantau", kind: "landmark", lat: 22.255, lon: 113.975, note: "大屿山" },
    { id: "HK", name: "Hong Kong", kind: "landmark", lat: 22.319, lon: 114.169, note: "香港岛方向" },
  ],
  procedures: [
    { id: "SID-CLP", type: "SID", name: "CLP 1A", runway: "07R", note: "示例 SID" },
    { id: "STAR-BEKOL", type: "STAR", name: "BEKOL 1A", runway: "25L", note: "示例 STAR" },
  ],
  // 以下为「航路 / 障碍 / 绕飞」示意：展示遇天气区后改航的路径；接入实装数据后替换坐标即可
  obstacleZones: [
    {
      id: "wx-cell-demo",
      name: "对流天气区 α",
      kind: "weather",
      note: "示意：机组需绕飞或申请偏航",
      polygon: [
        { lat: 22.378, lon: 113.985 },
        { lat: 22.402, lon: 114.015 },
        { lat: 22.392, lon: 114.042 },
        { lat: 22.368, lon: 114.008 },
      ],
    },
  ],
  routeLines: [
    {
      id: "rte-planned-1",
      name: "计划航路 AR1",
      kind: "planned",
      endLabel: "BEKOL",
      note: "直线穿越示意（与天气区相交，用于对比绕飞）",
      points: [
        { lat: 22.322, lon: 113.938 },
        { lat: 22.352, lon: 113.965 },
        { lat: 22.388, lon: 114.005 },
        { lat: 22.418, lon: 114.045 },
        { lat: 22.448, lon: 114.085 },
      ],
    },
    {
      id: "rte-detour-1",
      name: "绕飞改航",
      kind: "detour",
      endLabel: "BEKOL（汇合）",
      note: "遇 wx-cell-demo 后向东侧偏航再归队",
      points: [
        { lat: 22.352, lon: 113.965 },
        { lat: 22.372, lon: 114.02 },
        { lat: 22.395, lon: 114.048 },
        { lat: 22.418, lon: 114.045 },
        { lat: 22.448, lon: 114.085 },
      ],
    },
  ],
};

export function deriveBoundsFromData({
  adsb,
  statics,
}: {
  adsb: ADSBData[];
  statics?: VhhhStaticLayers;
}) {
  const lats: number[] = [];
  const lons: number[] = [];
  for (const p of adsb) {
    lats.push(p.latitude);
    lons.push(p.longitude);
  }
  for (const rw of statics?.runways ?? []) {
    for (const p of rw.points) {
      lats.push(p.lat);
      lons.push(p.lon);
    }
  }
  for (const twy of statics?.taxiways ?? []) {
    for (const p of twy.points) {
      lats.push(p.lat);
      lons.push(p.lon);
    }
  }
  for (const p of statics?.waypoints ?? []) {
    lats.push(p.lat);
    lons.push(p.lon);
  }
  for (const p of statics?.landmarks ?? []) {
    lats.push(p.lat);
    lons.push(p.lon);
  }
  for (const z of statics?.obstacleZones ?? []) {
    for (const p of z.polygon) {
      lats.push(p.lat);
      lons.push(p.lon);
    }
  }
  for (const r of statics?.routeLines ?? []) {
    for (const p of r.points) {
      lats.push(p.lat);
      lons.push(p.lon);
    }
  }
  const minLat = Math.min(...lats, 22.28);
  const maxLat = Math.max(...lats, 22.36);
  const minLon = Math.min(...lons, 113.90);
  const maxLon = Math.max(...lons, 114.20);
  return { minLat, maxLat, minLon, maxLon };
}

