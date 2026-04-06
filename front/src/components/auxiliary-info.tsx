"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ADSBData, AudioData } from "@/types";
import { formatTime } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMemo, useState } from "react";
import { vspAip } from "@/mock/vsp-aip";

interface AuxiliaryInfoProps {
  audioData?: AudioData;
  adsbData?: ADSBData[];
  currentTime?: number;
  selectedAircraft?: string;
}

export function AuxiliaryInfo({
  audioData,
  adsbData = [],
  currentTime = 0,
  selectedAircraft,
}: AuxiliaryInfoProps) {
  // 获取当前时间点的飞机数据
  const currentAircraftData = adsbData
    .filter((d) => d.icao24 === selectedAircraft && d.timestamp <= currentTime)
    .sort((a, b) => b.timestamp - a.timestamp)[0];

  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!query) {
      return {
        landmarks: vspAip.commonLandmarks,
        procedures: vspAip.procedures,
        airlines: vspAip.airlines,
      };
    }
    const match = (s: string) => s.toLowerCase().includes(query);
    return {
      landmarks: vspAip.commonLandmarks.filter((x) => match(x.name) || match(x.note ?? "")),
      procedures: vspAip.procedures.filter((x) => match(x.name) || match(x.type) || match(x.runway ?? "") || match(x.waypointHint ?? "")),
      airlines: vspAip.airlines.filter((x) => match(x.icao) || match(x.iata ?? "") || match(x.name) || match(x.callsign)),
    };
  }, [query]);

  return (
    <Card className="h-full rounded-3xl border-border/70 efb-panel efb-glow">
      <CardHeader>
        <CardTitle>辅助信息</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="vsp" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="audio">音频信息</TabsTrigger>
            <TabsTrigger value="aircraft">飞机信息</TabsTrigger>
            <TabsTrigger value="vsp">VSP/AIP</TabsTrigger>
          </TabsList>

          <TabsContent value="audio" className="space-y-4 mt-4">
            {audioData ? (
              <>
                <div className="space-y-2">
                  <div className="text-sm font-medium">音频ID</div>
                  <div className="text-sm text-muted-foreground">
                    {audioData.id}
                  </div>
                </div>
                {audioData.metadata?.icao && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium">ICAO</div>
                    <div className="text-sm text-muted-foreground">
                      {audioData.metadata.icao}
                    </div>
                  </div>
                )}
                {audioData.metadata?.date && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium">日期</div>
                    <div className="text-sm text-muted-foreground">
                      {audioData.metadata.date}
                    </div>
                  </div>
                )}
                {audioData.metadata?.frequency && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium">频率</div>
                    <div className="text-sm text-muted-foreground">
                      {audioData.metadata.frequency}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <div className="text-sm font-medium">时长</div>
                  <div className="text-sm text-muted-foreground">
                    {formatTime(audioData.duration)}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">时间戳数量</div>
                  <div className="text-sm text-muted-foreground">
                    {audioData.timestamps.length}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">暂无音频数据</p>
            )}
          </TabsContent>

          <TabsContent value="aircraft" className="space-y-4 mt-4">
            {currentAircraftData ? (
              <>
                <div className="space-y-2">
                  <div className="text-sm font-medium">呼号</div>
                  <div className="text-sm text-muted-foreground">
                    {currentAircraftData.callsign || "N/A"}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">ICAO24</div>
                  <div className="text-sm text-muted-foreground">
                    {currentAircraftData.icao24}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">位置</div>
                  <div className="text-sm text-muted-foreground">
                    {currentAircraftData.latitude.toFixed(4)},{" "}
                    {currentAircraftData.longitude.toFixed(4)}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">高度</div>
                  <div className="text-sm text-muted-foreground">
                    {currentAircraftData.altitude} ft
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">速度</div>
                  <div className="text-sm text-muted-foreground">
                    {currentAircraftData.speed} kts
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">航向</div>
                  <div className="text-sm text-muted-foreground">
                    {currentAircraftData.heading}°
                  </div>
                </div>
                {currentAircraftData.verticalRate !== undefined && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium">垂直速率</div>
                    <div className="text-sm text-muted-foreground">
                      {currentAircraftData.verticalRate} ft/min
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <div className="text-sm font-medium">时间戳</div>
                  <div className="text-sm text-muted-foreground">
                    {formatTime(currentAircraftData.timestamp)}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {selectedAircraft
                  ? "当前时间点无该飞机数据"
                  : "请选择一架飞机"}
              </p>
            )}
          </TabsContent>

          <TabsContent value="vsp" className="space-y-3 mt-4">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索：地标 / SID / STAR / 航司简字 / 呼号…"
              className="h-10 bg-background/40 border-border/60"
            />
            <ScrollArea className="h-[420px] pr-2">
              <div className="space-y-4">
                <section className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground">常用地标点</div>
                  <div className="space-y-2">
                    {filtered.landmarks.map((x) => (
                      <div key={x.name} className="rounded-xl border border-border/60 bg-background/20 p-3">
                        <div className="text-sm font-medium">{x.name}</div>
                        {x.note ? <div className="text-xs text-muted-foreground mt-1">{x.note}</div> : null}
                      </div>
                    ))}
                  </div>
                </section>

                <section className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground">SID / STAR</div>
                  <div className="space-y-2">
                    {filtered.procedures.map((x) => (
                      <div key={`${x.type}-${x.name}`} className="rounded-xl border border-border/60 bg-background/20 p-3">
                        <div className="text-sm font-medium">
                          <span className="text-primary">{x.type}</span> {x.name}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {x.runway ? `Runway ${x.runway}` : "Runway -"}{x.waypointHint ? ` · Hint: ${x.waypointHint}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground">航司简字 ↔ 呼号</div>
                  <div className="space-y-2">
                    {filtered.airlines.map((x) => {
                      const note = (x as { note?: string }).note;
                      return (
                        <div key={x.icao} className="rounded-xl border border-border/60 bg-background/20 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-medium truncate">{x.name}</div>
                            <div className="text-xs text-muted-foreground tabular-nums">
                              {(x.iata ? `${x.iata} / ` : "") + x.icao}
                            </div>
                          </div>
                          <div className="text-xs mt-1">
                            Callsign: <span className="text-primary font-semibold">{x.callsign}</span>
                          </div>
                          {note ? <div className="text-xs text-muted-foreground mt-1">{note}</div> : null}
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
