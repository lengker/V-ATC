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
// - 跑道使用香港 AIP AD 2.12 公布门槛坐标（VHHH）。
// - 滑行道为与跑道平行的场区示意线；完整 AIP 滑行道图可后续对接 A-5 / VSP。
// 跑道/滑行道坐标来自香港 AIP AD 2.12（VHHH，2026）门槛坐标；滑行道为场区平行滑行道示意
function dmsToDec(dms: string): { lat: number; lon: number } {
  const latMatch = dms.match(/(\d{2})(\d{2})([\d.]+)N/);
  const lonMatch = dms.match(/(\d{3})(\d{2})([\d.]+)E/);
  if (!latMatch || !lonMatch) throw new Error(`bad dms: ${dms}`);
  const lat = Number(latMatch[1]) + Number(latMatch[2]) / 60 + Number(latMatch[3]) / 3600;
  const lon = Number(lonMatch[1]) + Number(lonMatch[2]) / 60 + Number(lonMatch[3]) / 3600;
  return { lat, lon };
}

function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function offsetLine(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  offsetM: number,
  side: "left" | "right"
): [{ lat: number; lon: number }, { lat: number; lon: number }] {
  const brg = bearingDeg(a, b);
  const perp = side === "left" ? brg - 90 : brg + 90;
  const R = 6_371_000;
  const perpRad = (perp * Math.PI) / 180;
  const shift = (m: number, lat: number, lon: number) => {
    const latRad = (lat * Math.PI) / 180;
    const cosLat = Math.cos(latRad);
    return {
      lat: lat + (m / R) * Math.cos(perpRad) * (180 / Math.PI),
      lon: lon + (cosLat > 1e-6 ? ((m / R) * Math.sin(perpRad) / cosLat) * (180 / Math.PI) : 0),
    };
  };
  const a2 = shift(offsetM, a.lat, a.lon);
  const b2 = shift(offsetM, b.lat, b.lon);
  return [a2, b2];
}

const RWY_07L = dmsToDec("221917.72N1135256.26E");
const RWY_25R = dmsToDec("221954.45N1135450.24E");
const RWY_07C = dmsToDec("221840.58N1135356.64E");
const RWY_25C = dmsToDec("221912.85N1135536.78E");
const RWY_07R = dmsToDec("221748.03N1135357.99E");
const RWY_25L = dmsToDec("221826.75N1135558.15E");

export const vhhhStatic: VhhhStaticLayers = {
  runways: [
    {
      id: "07L-25R",
      name: "RWY 07L/25R",
      kind: "runway",
      points: [RWY_07L, RWY_25R],
      note: "AIP AD 2.12 门槛坐标",
    },
    {
      id: "07C-25C",
      name: "RWY 07C/25C",
      kind: "runway",
      points: [RWY_07C, RWY_25C],
      note: "AIP AD 2.12 门槛坐标",
    },
    {
      id: "07R-25L",
      name: "RWY 07R/25L",
      kind: "runway",
      points: [RWY_07R, RWY_25L],
      note: "AIP AD 2.12 门槛坐标",
    },
  ],
  taxiways: [
    {
      id: "TWY-N",
      name: "Parallel TWY (N)",
      kind: "taxiway",
      points: offsetLine(RWY_07L, RWY_25R, 280, "left"),
      note: "北场平行滑行道示意",
    },
    {
      id: "TWY-M",
      name: "Parallel TWY (Mid)",
      kind: "taxiway",
      points: offsetLine(RWY_07C, RWY_25C, 260, "right"),
      note: "中场平行滑行道示意",
    },
    {
      id: "TWY-S",
      name: "Parallel TWY (S)",
      kind: "taxiway",
      points: offsetLine(RWY_07R, RWY_25L, 280, "right"),
      note: "南场平行滑行道示意",
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

