export type AirlineCallsign = {
  iata?: string;
  icao: string;
  name: string;
  callsign: string;
  note?: string;
};

export type ProcedureName = {
  type: "SID" | "STAR";
  name: string;
  runway?: string;
  waypointHint?: string;
};

export type Landmark = {
  name: string;
  lat?: number;
  lon?: number;
  note?: string;
};

// 说明：这里是“辅助标注信息”的 mock 数据集。
// 后续 A-5 模块整理 VSP/AIP 后，直接把数据源换成接口或静态 JSON 文件即可。
export const vspAip = {
  commonLandmarks: [
    { name: "Lantau (大屿山)", note: "VHHH 西南侧地标" },
    { name: "Victoria Harbour (维多利亚港)", note: "香港岛北侧水域" },
    { name: "Stonecutters Bridge (昂船洲大桥)", note: "常见目视参考" },
  ] satisfies Landmark[],
  procedures: [
    { type: "SID", name: "CLP 1A", runway: "07R", waypointHint: "CLP" },
    { type: "SID", name: "SOKOE 1A", runway: "25L", waypointHint: "SOKOE" },
    { type: "STAR", name: "BEKOL 1A", runway: "25L", waypointHint: "BEKOL" },
    { type: "STAR", name: "TAMOT 1A", runway: "07R", waypointHint: "TAMOT" },
  ] satisfies ProcedureName[],
  airlines: [
    { iata: "CX", icao: "CPA", name: "Cathay Pacific", callsign: "CATHAY" },
    { iata: "HX", icao: "CRK", name: "HK Express", callsign: "BAUHINIA" },
    { iata: "UO", icao: "HKE", name: "Hong Kong Airlines", callsign: "HONG KONG" },
    { iata: "KA", icao: "HDA", name: "Hong Kong Dragon (legacy)", callsign: "DRAGON" },
    { iata: "SQ", icao: "SIA", name: "Singapore Airlines", callsign: "SINGAPORE" },
    { iata: "EK", icao: "UAE", name: "Emirates", callsign: "EMIRATES" },
  ] satisfies AirlineCallsign[],
};

