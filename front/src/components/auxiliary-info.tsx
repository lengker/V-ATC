"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatTime } from "@/lib/utils";
import {
  VspAirline,
  VspAirport,
  VspFrequency,
  VspNavaid,
  VspProcedure,
  VspRunway,
  VspWaypoint,
  vspAPI,
} from "@/lib/api";
import { ADSBData, AudioData } from "@/types";

interface AuxiliaryInfoProps {
  audioData?: AudioData;
  adsbData?: ADSBData[];
  currentTime?: number;
  selectedAircraft?: string;
}

type VspData = {
  airports: VspAirport[];
  runways: VspRunway[];
  frequencies: VspFrequency[];
  navaids: VspNavaid[];
  waypoints: VspWaypoint[];
  procedures: VspProcedure[];
  airlines: VspAirline[];
};

const emptyVspData: VspData = {
  airports: [],
  runways: [],
  frequencies: [],
  navaids: [],
  waypoints: [],
  procedures: [],
  airlines: [],
};

function parseExtraJson(extraJson?: string | null): Record<string, unknown> {
  if (!extraJson) return {};
  try {
    const parsed = JSON.parse(extraJson);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseAirlineIcao(extraJson?: string | null) {
  const parsed = parseExtraJson(extraJson);
  return typeof parsed.icao === "string" ? parsed.icao : undefined;
}

function joinParts(parts: Array<string | number | null | undefined>) {
  return parts.filter((part) => part !== undefined && part !== null && part !== "").join(" · ");
}

function formatCoord(lat?: number | null, lng?: number | null) {
  if (lat == null || lng == null) return undefined;
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function formatProcedureType(value?: string | null) {
  const upper = String(value ?? "").toUpperCase();
  if (upper === "SID") return "SID 离场";
  if (upper === "STAR") return "STAR 进场";
  return upper || "程序";
}

function parseWaypointSequence(value?: string | null) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item)).filter(Boolean).join(" → ");
    }
  } catch {
    return value;
  }
  return value;
}

function isLandmarkWaypoint(waypoint: VspWaypoint) {
  const type = String(waypoint.type ?? "").toLowerCase();
  const extra = parseExtraJson(waypoint.extra_json);
  return (
    type.includes("landmark") ||
    type.includes("visual") ||
    type.includes("fix") ||
    extra.landmark === true ||
    extra.common === true
  );
}

function isVspAirport(item: VspAirport | VspNavaid | VspWaypoint): item is VspAirport {
  return "icao_code" in item && "airport_name" in item;
}

function isVspNavaid(item: VspAirport | VspNavaid | VspWaypoint): item is VspNavaid {
  return "navaid_id" in item;
}

export function AuxiliaryInfo({
  audioData,
  adsbData = [],
  currentTime = 0,
  selectedAircraft,
}: AuxiliaryInfoProps) {
  const currentAircraftData = adsbData
    .filter((d) => d.icao24 === selectedAircraft && d.timestamp <= currentTime)
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  const [q, setQ] = useState("");
  const [vspData, setVspData] = useState<VspData>(emptyVspData);
  const [vspLoading, setVspLoading] = useState(true);
  const [vspError, setVspError] = useState<string | null>(null);
  const query = q.trim().toLowerCase();
  const airportIcao = audioData?.metadata?.icao || "VHHH";

  useEffect(() => {
    let cancelled = false;

    async function loadVspData() {
      setVspLoading(true);
      setVspError(null);
      try {
        const airports = await vspAPI.airports(airportIcao);
        const airportId = airports[0]?.airport_id;
        const [runways, frequencies, navaids, waypointsPage, procedures, airlines] = await Promise.all([
          vspAPI.runways(airportId),
          vspAPI.frequencies(airportId),
          vspAPI.navaids(airportId),
          vspAPI.waypoints(),
          vspAPI.procedures(airportId),
          vspAPI.airlines(),
        ]);

        if (!cancelled) {
          setVspData({ airports, runways, frequencies, navaids, waypoints: waypointsPage.items, procedures, airlines });
        }
      } catch (error) {
        if (!cancelled) {
          setVspError(error instanceof Error ? error.message : "VSP/AIP 数据加载失败");
        }
      } finally {
        if (!cancelled) {
          setVspLoading(false);
        }
      }
    }

    loadVspData();

    return () => {
      cancelled = true;
    };
  }, [airportIcao]);

  const filtered = useMemo(() => {
    const match = (...values: Array<string | number | null | undefined>) =>
      !query || values.some((value) => String(value ?? "").toLowerCase().includes(query));

    return {
      airports: vspData.airports.filter((x) =>
        match(x.icao_code, x.iata_code, x.airport_name, x.city_name, x.country_name)
      ),
      runways: vspData.runways.filter((x) =>
        match(x.runway_designator, x.surface_type, x.runway_length_m, x.runway_width_m, x.bearing_deg)
      ),
      frequencies: vspData.frequencies.filter((x) =>
        match(x.service_designator, x.callsign, x.frequency, x.hours_of_operation, x.remarks)
      ),
      navaids: vspData.navaids.filter((x) =>
        match(x.ident, x.name, x.navaid_type, x.frequency, x.hours_of_operation, x.remarks)
      ),
      waypoints: vspData.waypoints.filter((x) =>
        match(x.name, x.type, x.description, x.lat, x.lng)
      ),
      procedures: vspData.procedures.filter((x) =>
        match(x.procedure_code, x.procedure_name, x.procedure_type, x.runway, x.waypoint_sequence_json)
      ),
      airlines: vspData.airlines.filter((x) =>
        match(x.airline_code, parseAirlineIcao(x.extra_json), x.airline_name, x.airline_short_name, x.country_name)
      ),
    };
  }, [query, vspData]);

  const summary = useMemo(() => {
    const landmarkWaypoints = vspData.waypoints.filter(isLandmarkWaypoint).slice(0, 8);
    const navaidLandmarks = vspData.navaids.slice(0, 5);
    const procedures = vspData.procedures.slice(0, 8);
    const airlines = vspData.airlines.slice(0, 10);
    return { landmarkWaypoints, navaidLandmarks, procedures, airlines };
  }, [vspData]);

  return (
    <Card className="dashboard-card flex h-full min-h-0 flex-col overflow-hidden border-border/70 efb-panel efb-glow">
      <CardHeader className="shrink-0 px-2 py-2">
        <CardTitle className="text-sm font-semibold tracking-tight">辅助信息</CardTitle>
      </CardHeader>
      <CardContent className="card-body min-h-0 flex-1 px-2 pb-2 pt-0">
        <Tabs defaultValue="vsp" className="flex h-full min-h-0 w-full flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="audio">音频</TabsTrigger>
            <TabsTrigger value="aircraft">航空器</TabsTrigger>
            <TabsTrigger value="vsp">VSP/AIP</TabsTrigger>
          </TabsList>

          <TabsContent value="audio" className="info-list mt-2 min-h-0 flex-1 space-y-2 pr-1">
            {audioData ? (
              <>
                <InfoRow label="音频编号" value={audioData.id} />
                {audioData.metadata?.icao ? <InfoRow label="ICAO" value={audioData.metadata.icao} /> : null}
                {audioData.metadata?.date ? <InfoRow label="日期" value={audioData.metadata.date} /> : null}
                {audioData.metadata?.frequency ? <InfoRow label="频率" value={audioData.metadata.frequency} /> : null}
                <InfoRow label="时长" value={formatTime(audioData.duration)} />
                <InfoRow label="时间戳数量" value={audioData.timestamps.length} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">暂无音频数据。</p>
            )}
          </TabsContent>

          <TabsContent value="aircraft" className="info-list mt-2 min-h-0 flex-1 space-y-2 pr-1">
            {currentAircraftData ? (
              <>
                <InfoRow label="呼号" value={currentAircraftData.callsign || "暂无"} />
                <InfoRow label="ICAO24" value={currentAircraftData.icao24} />
                <InfoRow
                  label="位置"
                  value={`${currentAircraftData.latitude.toFixed(4)}, ${currentAircraftData.longitude.toFixed(4)}`}
                />
                <InfoRow
                  label="高度"
                  value={
                    Number.isFinite(currentAircraftData.altitude)
                      ? `${Math.round(currentAircraftData.altitude ?? 0)} 英尺`
                      : "暂无"
                  }
                />
                <InfoRow label="速度" value={`${currentAircraftData.speed} 节`} />
                <InfoRow label="航向" value={`${currentAircraftData.heading} 度`} />
                {currentAircraftData.verticalRate !== undefined ? (
                  <InfoRow label="垂直速度" value={`${currentAircraftData.verticalRate} 英尺/分钟`} />
                ) : null}
                <InfoRow label="时间戳" value={formatTime(currentAircraftData.timestamp)} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {selectedAircraft ? "当前时间暂无航空器数据。" : "请选择航空器。"}
              </p>
            )}
          </TabsContent>

          <TabsContent value="vsp" className="mt-2 flex min-h-0 flex-1 flex-col space-y-2 overflow-hidden">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索 VSP/AIP：机场、跑道、频率、地标、SID/STAR、航司"
              className="h-8 bg-background/40 border-border/60 text-xs"
            />
            <ScrollArea className="info-list h-auto min-h-0 flex-1 pr-2">
              {vspLoading ? (
                <p className="text-sm text-muted-foreground">正在加载 VSP/AIP 数据...</p>
              ) : vspError ? (
                <p className="text-sm text-destructive">{vspError}</p>
              ) : (
                <div className="space-y-4">
                  <VspSummary
                    airports={vspData.airports}
                    landmarkWaypoints={summary.landmarkWaypoints}
                    navaidLandmarks={summary.navaidLandmarks}
                    procedures={summary.procedures}
                    airlines={summary.airlines}
                  />

                  <VspSection title={`机场 / 跑道（${filtered.airports.length + filtered.runways.length}）`}>
                    {filtered.airports.map((x) => (
                      <VspCard
                        key={x.airport_id}
                        title={x.airport_name}
                        meta={`${x.icao_code}${x.iata_code ? ` / ${x.iata_code}` : ""}`}
                        detail={joinParts([
                          formatCoord(x.lat, x.lng),
                          x.elevation_ft != null ? `${x.elevation_ft} ft` : null,
                          x.city_name,
                          x.country_name,
                        ])}
                      />
                    ))}
                    {filtered.runways.map((x) => (
                      <VspCard
                        key={x.runway_id}
                        title={`跑道 ${x.runway_designator}`}
                        meta={`${x.runway_length_m ?? "-"} x ${x.runway_width_m ?? "-"} m`}
                        detail={joinParts([
                          x.surface_type ?? "道面 -",
                          x.bearing_deg != null ? `${x.bearing_deg}°` : null,
                          x.threshold_lat != null && x.threshold_lng != null
                            ? `THR ${formatCoord(x.threshold_lat, x.threshold_lng)}`
                            : null,
                        ])}
                      />
                    ))}
                  </VspSection>

                  <VspSection title={`频率 / 导航台 / 地标点（${filtered.frequencies.length + filtered.navaids.length + filtered.waypoints.length}）`}>
                    {filtered.frequencies.map((x) => (
                      <VspCard
                        key={x.frequency_id}
                        title={x.callsign ?? x.service_designator ?? "频率"}
                        meta={x.frequency}
                        detail={joinParts([x.service_designator, x.hours_of_operation, x.remarks])}
                        metaClassName="text-primary font-semibold"
                      />
                    ))}
                    {filtered.navaids.map((x) => (
                      <VspCard
                        key={x.navaid_id}
                        title={`${x.ident}${x.name ? ` · ${x.name}` : ""}`}
                        meta={x.navaid_type ?? "导航台"}
                        detail={joinParts([x.frequency ?? "频率 -", formatCoord(x.lat, x.lng), x.remarks])}
                      />
                    ))}
                    {filtered.waypoints.map((x) => (
                      <VspCard
                        key={x.waypoint_id}
                        title={x.name}
                        meta={x.type ?? "地标/航路点"}
                        detail={joinParts([x.description, formatCoord(x.lat, x.lng)])}
                      />
                    ))}
                  </VspSection>

                  <VspSection title={`SID / STAR 航线名称（${filtered.procedures.length}）`}>
                    {filtered.procedures.map((x) => (
                      <VspCard
                        key={x.procedure_id}
                        title={`${formatProcedureType(x.procedure_type)} · ${x.procedure_name}`}
                        meta={x.procedure_code}
                        detail={joinParts([
                          x.runway ? `跑道 ${x.runway}` : null,
                          parseWaypointSequence(x.waypoint_sequence_json),
                        ])}
                      />
                    ))}
                    {filtered.procedures.length === 0 ? (
                      <p className="text-xs text-muted-foreground">后端暂未返回 SID/STAR 程序记录。</p>
                    ) : null}
                  </VspSection>

                  <VspSection title={`航空公司简字 / 呼号对应（${filtered.airlines.length}）`}>
                    {filtered.airlines.map((x) => {
                      const icao = parseAirlineIcao(x.extra_json);
                      return (
                        <VspCard
                          key={x.airline_id}
                          title={x.airline_name}
                          meta={`${x.airline_code}${icao ? ` / ${icao}` : ""}`}
                          detail={joinParts([`呼号 ${x.airline_short_name ?? "-"}`, x.country_name])}
                        />
                      );
                    })}
                  </VspSection>
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function VspSummary({
  airports,
  landmarkWaypoints,
  navaidLandmarks,
  procedures,
  airlines,
}: {
  airports: VspAirport[];
  landmarkWaypoints: VspWaypoint[];
  navaidLandmarks: VspNavaid[];
  procedures: VspProcedure[];
  airlines: VspAirline[];
}) {
  return (
    <section className="space-y-2 rounded-lg border border-primary/25 bg-primary/5 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-primary">VSP/AIP 快速参考</div>
        <div className="text-[11px] text-muted-foreground">
          {airports[0]?.icao_code ?? "VHHH"} · 地标 / SID STAR / 航司
        </div>
      </div>

      <SummaryBlock title="常用地标点">
        {([...airports, ...navaidLandmarks, ...landmarkWaypoints] as Array<VspAirport | VspNavaid | VspWaypoint>).slice(0, 10).map((item) => {
          if (isVspAirport(item)) {
            return (
              <MiniLine
                key={item.airport_id}
                label={`${item.icao_code}${item.iata_code ? `/${item.iata_code}` : ""}`}
                value={item.airport_name}
              />
            );
          }
          if (isVspNavaid(item)) {
            return <MiniLine key={item.navaid_id} label={item.ident} value={item.name ?? item.navaid_type ?? "导航台"} />;
          }
          return <MiniLine key={item.waypoint_id} label={item.name} value={item.description ?? item.type ?? "航路点"} />;
        })}
      </SummaryBlock>

      <SummaryBlock title="SID / STAR 航线">
        {procedures.length > 0 ? (
          procedures.map((item) => (
            <MiniLine
              key={item.procedure_id}
              label={item.procedure_code}
              value={joinParts([formatProcedureType(item.procedure_type), item.runway ? `RWY ${item.runway}` : null])}
            />
          ))
        ) : (
          <MiniLine label="-" value="暂无程序数据" />
        )}
      </SummaryBlock>

      <SummaryBlock title="航空公司简字 / 呼号">
        {airlines.length > 0 ? (
          airlines.map((item) => {
            const icao = parseAirlineIcao(item.extra_json);
            return (
              <MiniLine
                key={item.airline_id}
                label={`${item.airline_code}${icao ? `/${icao}` : ""}`}
                value={item.airline_short_name ?? item.airline_name}
              />
            );
          })
        ) : (
          <MiniLine label="-" value="暂无航司数据" />
        )}
      </SummaryBlock>
    </section>
  );
}

function SummaryBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function MiniLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-background/35 px-2 py-1 text-xs">
      <span className="shrink-0 font-semibold text-foreground">{label}</span>
      <span className="truncate text-muted-foreground">{value}</span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium">{label}</div>
      <div className="text-sm text-muted-foreground">{value}</div>
    </div>
  );
}

function VspSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <div className="text-xs font-semibold text-muted-foreground">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function VspCard({
  title,
  meta,
  detail,
  metaClassName = "text-muted-foreground",
}: {
  title: string;
  meta?: string;
  detail?: string;
  metaClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/20 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-sm font-medium">{title}</div>
        {meta ? <div className={`shrink-0 text-xs tabular-nums ${metaClassName}`}>{meta}</div> : null}
      </div>
      {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  );
}
