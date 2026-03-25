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

export type VhhhStaticLayers = {
  runways: StaticLine[];
  taxiways: StaticLine[];
  waypoints: StaticPoint[];
  landmarks: StaticPoint[];
  procedures: Array<{ id: string; type: "SID" | "STAR"; name: string; runway?: string; note?: string }>;
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
  const minLat = Math.min(...lats, 22.28);
  const maxLat = Math.max(...lats, 22.36);
  const minLon = Math.min(...lons, 113.90);
  const maxLon = Math.max(...lons, 114.20);
  return { minLat, maxLat, minLon, maxLon };
}

