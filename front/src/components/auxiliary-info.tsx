"use client";

import { useEffect, useMemo, useState } from "react";
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

function parseAirlineIcao(extraJson?: string | null) {
  if (!extraJson) return undefined;
  try {
    const parsed = JSON.parse(extraJson) as { icao?: string };
    return parsed.icao;
  } catch {
    return undefined;
  }
}

function joinParts(parts: Array<string | number | null | undefined>) {
  return parts.filter((part) => part !== undefined && part !== null && part !== "").join(" · ");
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

  useEffect(() => {
    let cancelled = false;

    async function loadVspData() {
      setVspLoading(true);
      setVspError(null);
      try {
        const airports = await vspAPI.airports();
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
          setVspError(error instanceof Error ? error.message : "Failed to load VSP data");
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
  }, []);

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

  return (
    <Card className="h-full rounded-3xl border-border/70 efb-panel efb-glow">
      <CardHeader>
        <CardTitle>Auxiliary Info</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="vsp" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="audio">Audio</TabsTrigger>
            <TabsTrigger value="aircraft">Aircraft</TabsTrigger>
            <TabsTrigger value="vsp">VSP/AIP</TabsTrigger>
          </TabsList>

          <TabsContent value="audio" className="space-y-4 mt-4">
            {audioData ? (
              <>
                <InfoRow label="Audio ID" value={audioData.id} />
                {audioData.metadata?.icao ? <InfoRow label="ICAO" value={audioData.metadata.icao} /> : null}
                {audioData.metadata?.date ? <InfoRow label="Date" value={audioData.metadata.date} /> : null}
                {audioData.metadata?.frequency ? (
                  <InfoRow label="Frequency" value={audioData.metadata.frequency} />
                ) : null}
                <InfoRow label="Duration" value={formatTime(audioData.duration)} />
                <InfoRow label="Timestamp count" value={audioData.timestamps.length} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No audio data.</p>
            )}
          </TabsContent>

          <TabsContent value="aircraft" className="space-y-4 mt-4">
            {currentAircraftData ? (
              <>
                <InfoRow label="Callsign" value={currentAircraftData.callsign || "N/A"} />
                <InfoRow label="ICAO24" value={currentAircraftData.icao24} />
                <InfoRow
                  label="Position"
                  value={`${currentAircraftData.latitude.toFixed(4)}, ${currentAircraftData.longitude.toFixed(4)}`}
                />
                <InfoRow label="Altitude" value={`${currentAircraftData.altitude} ft`} />
                <InfoRow label="Speed" value={`${currentAircraftData.speed} kts`} />
                <InfoRow label="Heading" value={`${currentAircraftData.heading} deg`} />
                {currentAircraftData.verticalRate !== undefined ? (
                  <InfoRow label="Vertical rate" value={`${currentAircraftData.verticalRate} ft/min`} />
                ) : null}
                <InfoRow label="Timestamp" value={formatTime(currentAircraftData.timestamp)} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {selectedAircraft ? "No aircraft data at the current time." : "Select an aircraft."}
              </p>
            )}
          </TabsContent>

          <TabsContent value="vsp" className="space-y-3 mt-4">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search VSP: airport, runway, frequency, navaid, airline"
              className="h-10 bg-background/40 border-border/60"
            />
            <ScrollArea className="h-[420px] pr-2">
              {vspLoading ? (
                <p className="text-sm text-muted-foreground">Loading VSP data...</p>
              ) : vspError ? (
                <p className="text-sm text-destructive">{vspError}</p>
              ) : (
                <div className="space-y-4">
                  <VspSection title={`Airports / Runways (${filtered.airports.length + filtered.runways.length})`}>
                    {filtered.airports.map((x) => (
                      <VspCard
                        key={x.airport_id}
                        title={x.airport_name}
                        meta={`${x.icao_code}${x.iata_code ? ` / ${x.iata_code}` : ""}`}
                        detail={joinParts([
                          `${x.lat.toFixed(5)}, ${x.lng.toFixed(5)}`,
                          x.elevation_ft != null ? `${x.elevation_ft} ft` : null,
                          x.city_name,
                          x.country_name,
                        ])}
                      />
                    ))}
                    {filtered.runways.map((x) => (
                      <VspCard
                        key={x.runway_id}
                        title={`Runway ${x.runway_designator}`}
                        meta={`${x.runway_length_m ?? "-"} x ${x.runway_width_m ?? "-"} m`}
                        detail={joinParts([
                          x.surface_type ?? "Surface -",
                          x.bearing_deg != null ? `${x.bearing_deg} deg` : null,
                          x.threshold_lat != null && x.threshold_lng != null
                            ? `THR ${x.threshold_lat.toFixed(5)}, ${x.threshold_lng.toFixed(5)}`
                            : null,
                        ])}
                      />
                    ))}
                  </VspSection>

                  <VspSection title={`Frequencies / Navaids / Waypoints (${filtered.frequencies.length + filtered.navaids.length + filtered.waypoints.length})`}>
                    {filtered.frequencies.map((x) => (
                      <VspCard
                        key={x.frequency_id}
                        title={x.callsign ?? x.service_designator ?? "Frequency"}
                        meta={x.frequency}
                        detail={joinParts([x.service_designator, x.hours_of_operation, x.remarks])}
                        metaClassName="text-primary font-semibold"
                      />
                    ))}
                    {filtered.navaids.map((x) => (
                      <VspCard
                        key={x.navaid_id}
                        title={x.ident}
                        meta={x.navaid_type ?? "Navaid"}
                        detail={joinParts([
                          x.frequency ?? "Frequency -",
                          `${x.lat.toFixed(5)}, ${x.lng.toFixed(5)}`,
                          x.remarks,
                        ])}
                      />
                    ))}
                    {filtered.waypoints.map((x) => (
                      <VspCard
                        key={x.waypoint_id}
                        title={x.name}
                        meta={x.type ?? "Waypoint"}
                        detail={joinParts([
                          x.description,
                          `${x.lat.toFixed(5)}, ${x.lng.toFixed(5)}`,
                        ])}
                      />
                    ))}
                  </VspSection>

                  <VspSection title={`SID / STAR (${filtered.procedures.length})`}>
                    {filtered.procedures.map((x) => (
                      <VspCard
                        key={x.procedure_id}
                        title={`${x.procedure_type.toUpperCase()} ${x.procedure_name}`}
                        meta={x.procedure_code}
                        detail={joinParts([
                          x.runway ? `Runway ${x.runway}` : null,
                          x.waypoint_sequence_json,
                        ])}
                      />
                    ))}
                    {filtered.procedures.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No procedure records returned by the backend.</p>
                    ) : null}
                  </VspSection>

                  <VspSection title={`Airlines / Callsigns (${filtered.airlines.length})`}>
                    {filtered.airlines.map((x) => {
                      const icao = parseAirlineIcao(x.extra_json);
                      return (
                        <VspCard
                          key={x.airline_id}
                          title={x.airline_name}
                          meta={`${x.airline_code}${icao ? ` / ${icao}` : ""}`}
                          detail={joinParts([
                            `Callsign: ${x.airline_short_name ?? "-"}`,
                            x.country_name,
                          ])}
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

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      <div className="text-sm text-muted-foreground">{value}</div>
    </div>
  );
}

function VspSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="text-xs font-semibold text-muted-foreground">{title}</div>
      <div className="space-y-2">{children}</div>
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
    <div className="rounded-xl border border-border/60 bg-background/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium truncate">{title}</div>
        {meta ? <div className={`text-xs tabular-nums ${metaClassName}`}>{meta}</div> : null}
      </div>
      {detail ? <div className="text-xs text-muted-foreground mt-1">{detail}</div> : null}
    </div>
  );
}
