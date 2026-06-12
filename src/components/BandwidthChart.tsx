import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { useSettings } from "@/features/settings/store";
import { statsApi, type TrafficRates } from "@/lib/api";
import { cn } from "@/lib/utils";
import { bytesFromKbps, formatByteRateFromBytes } from "@/lib/bandwidth";

type Range = "1m" | "1h" | "24h";

interface Point {
  t: number;
  apiBps: number;
  webBps: number;
  cctvPullBps: number;
  cctvOutBps: number;
  totalBps: number;
}

function toPoint(r: TrafficRates): Point {
  const apiBps = r.apiBytesPerSec ?? bytesFromKbps(r.apiKbps || 0);
  const webBps = r.webBytesPerSec ?? bytesFromKbps(r.webKbps || 0);
  const cctvPullBps = r.cctvPullBytesPerSec ?? bytesFromKbps(r.cctvPullKbps || 0);
  const cctvOutBps = r.cctvOutBytesPerSec ?? bytesFromKbps(r.cctvOutKbps || 0);
  return {
    t: r.ts || Date.now(),
    apiBps,
    webBps,
    cctvPullBps,
    cctvOutBps,
    totalBps: r.totalBytesPerSec ?? (apiBps + webBps + cctvPullBps + cctvOutBps),
  };
}

export function BandwidthChart() {
  const autoRefresh = useSettings((s) => s.settings.autoRefresh);
  const [range, setRange] = useState<Range>("1h");
  const historyQuery = useQuery({
    queryKey: ["traffic-history", range],
    queryFn: () => statsApi.trafficHistory(range),
    refetchInterval: autoRefresh ? 2000 : false,
    staleTime: 1000,
    placeholderData: (previous) => previous,
  });

  const data = useMemo(() => {
    return (historyQuery.data?.points || [])
      .map(toPoint)
      .map((p) => ({
        ...p,
        label: new Date(p.t).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: range === "1m" ? "2-digit" : undefined }),
      }));
  }, [historyQuery.data, range]);

  const current = data[data.length - 1] ?? {
    t: Date.now(),
    apiBps: 0,
    webBps: 0,
    cctvPullBps: 0,
    cctvOutBps: 0,
    totalBps: 0,
    label: "",
  };
  const peak = data.reduce((m, p) => Math.max(m, p.totalBps), current.totalBps);
  const avg = data.length ? data.reduce((a, p) => a + p.totalBps, 0) / data.length : current.totalBps;

  return (
    <Card className="p-4 glass-panel border-border/60">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">Grafik Bandwidth Real-time</div>
            <div className="text-xs text-muted-foreground">
              History backend tersimpan 24 jam · Data yang sama untuk seluruh pengguna
              {!autoRefresh && <span className="ml-1 text-warning">(auto-refresh nonaktif)</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-3 mr-2 text-xs">
            <Stat label="Now" value={formatByteRateFromBytes(current.totalBps)} tone="primary" />
            <Stat label="Avg" value={formatByteRateFromBytes(avg)} />
            <Stat label="Peak" value={formatByteRateFromBytes(peak)} />
          </div>
          <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
            {(["1m", "1h", "24h"] as Range[]).map((r) => (
              <Button
                key={r}
                size="sm"
                variant="ghost"
                onClick={() => setRange(r)}
                className={cn(
                  "h-7 px-2.5 text-xs font-medium rounded-sm",
                  range === r && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                )}
              >
                {r}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3 text-xs">
        <Mini label="Pull CCTV" value={formatByteRateFromBytes(current.cctvPullBps)} />
        <Mini label="CCTV keluar" value={formatByteRateFromBytes(current.cctvOutBps)} />
        <Mini label="API" value={formatByteRateFromBytes(current.apiBps)} />
        <Mini label="Web" value={formatByteRateFromBytes(current.webBps)} />
      </div>

      <div className="h-56 -ml-2">
        {historyQuery.isError && (
          <div className="absolute text-xs text-destructive">History bandwidth belum dapat dimuat.</div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} minTickGap={28} />
            <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={64} tickFormatter={(v) => formatByteRateFromBytes(Number(v)).replace("/s", "")} />
            <Tooltip
              contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "hsl(var(--muted-foreground))" }}
              formatter={(value: number, name) => [formatByteRateFromBytes(Number(value)), String(name)]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="cctvPullBps" name="Pull CCTV" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} isAnimationActive={false} />
            <Line type="monotone" dataKey="cctvOutBps" name="CCTV keluar" stroke="hsl(var(--warning))" dot={false} strokeWidth={2} isAnimationActive={false} />
            <Line type="monotone" dataKey="apiBps" name="API" stroke="hsl(var(--info))" dot={false} strokeWidth={1.7} isAnimationActive={false} />
            <Line type="monotone" dataKey="webBps" name="Web" stroke="hsl(var(--muted-foreground))" dot={false} strokeWidth={1.5} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "primary" }) {
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("font-semibold tabular-nums", tone === "primary" && "text-primary")}>
        <Badge variant="outline" className="font-mono text-[11px] py-0 px-1.5">{value}</Badge>
      </span>
    </div>
  );
}
