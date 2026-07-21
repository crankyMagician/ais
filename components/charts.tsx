"use client";

import { useState } from "react";

// Categorical slots validated against the dark panel surface (#111a2c):
// worst adjacent CVD deltaE 41.3, all >= 3:1 contrast.
export const SERIES = ["#3987e5", "#199e70", "#c98500"];
export const CLASS_COLORS: Record<string, string> = {
  "possibly-deliberate": SERIES[0],
  "likely-coverage-loss": SERIES[1],
  unknown: SERIES[2],
};
export const CLASS_LABELS: Record<string, string> = {
  "possibly-deliberate": "Possibly deliberate",
  "likely-coverage-loss": "Likely coverage loss",
  unknown: "Unknown",
};
// Status colors (reserved roles, always paired with a glyph + label).
export const STATUS = { ok: "#0ca30c", degraded: "#fab219", down: "#d03b3b" };

const INK = { primary: "#e6edf7", secondary: "#93a1b8", grid: "#23304b" };

interface Tip {
  x: number;
  y: number;
  text: string;
}

function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (e: React.MouseEvent, text: string) => {
    const host = (e.currentTarget as SVGElement).closest(".chart");
    const r = host?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top - 8, text });
  };
  const node = tip ? (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>
      {tip.text}
    </div>
  ) : null;
  return { show, hide: () => setTip(null), node };
}

// Bar with 4px rounding on the data end only, anchored square at the baseline.
function barPath(
  x: number,
  y: number,
  w: number,
  h: number,
  end: "right" | "top",
): string {
  const r = Math.min(4, end === "right" ? w : h);
  if (w <= 0 || h <= 0) return "";
  if (end === "right")
    return `M${x},${y} h${w - r} a${r},${r} 0 0 1 ${r},${r} v${h - 2 * r} a${r},${r} 0 0 1 -${r},${r} h${-(w - r)} z`;
  return `M${x},${y + h} v${-(h - r)} a${r},${r} 0 0 1 ${r},-${r} h${w - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - r} z`;
}

export function HBarChart({
  data,
  color = SERIES[0],
  unit = "",
}: {
  data: Array<{ label: string; value: number; color?: string }>;
  color?: string;
  unit?: string;
}) {
  const tip = useTip();
  if (!data.length) return <p className="muted">No data in this window.</p>;
  const max = Math.max(...data.map((d) => d.value), 1);
  const rowH = 26;
  const labelW = 150;
  const W = 520;
  const H = data.length * rowH;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img">
        {data.map((d, i) => {
          const w = Math.max(2, (d.value / max) * (W - labelW - 46));
          const y = i * rowH + 4;
          return (
            <g
              key={d.label}
              onMouseMove={(e) => tip.show(e, `${d.label}: ${d.value}${unit}`)}
              onMouseLeave={tip.hide}
            >
              <rect x={0} y={i * rowH} width={W} height={rowH} fill="transparent" />
              <text
                x={labelW - 8}
                y={y + 13}
                textAnchor="end"
                fontSize={12}
                fill={INK.secondary}
              >
                {d.label.length > 20 ? d.label.slice(0, 19) + "…" : d.label}
              </text>
              <path d={barPath(labelW, y, w, rowH - 8, "right")} fill={d.color ?? color} />
              <text
                x={labelW + w + 6}
                y={y + 13}
                fontSize={12}
                fill={INK.primary}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {d.value}
              </text>
            </g>
          );
        })}
      </svg>
      {tip.node}
    </div>
  );
}

export function Histogram({
  data,
  color = SERIES[0],
}: {
  data: Array<{ label: string; value: number }>;
  color?: string;
}) {
  const tip = useTip();
  const max = Math.max(...data.map((d) => d.value), 1);
  const W = 520;
  const H = 170;
  const pad = { top: 14, bottom: 24 };
  const bw = W / data.length;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img">
        <line x1={0} y1={H - pad.bottom} x2={W} y2={H - pad.bottom} stroke={INK.grid} />
        {data.map((d, i) => {
          const h = Math.max(d.value > 0 ? 3 : 0, (d.value / max) * (H - pad.top - pad.bottom));
          const x = i * bw + 5;
          const y = H - pad.bottom - h;
          return (
            <g
              key={d.label}
              onMouseMove={(e) => tip.show(e, `${d.label}: ${d.value} events`)}
              onMouseLeave={tip.hide}
            >
              <rect x={i * bw} y={0} width={bw} height={H} fill="transparent" />
              {h > 0 && <path d={barPath(x, y, bw - 10, h, "top")} fill={color} />}
              {d.value > 0 && (
                <text
                  x={i * bw + bw / 2}
                  y={y - 4}
                  textAnchor="middle"
                  fontSize={11}
                  fill={INK.primary}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {d.value}
                </text>
              )}
              <text
                x={i * bw + bw / 2}
                y={H - 8}
                textAnchor="middle"
                fontSize={10.5}
                fill={INK.secondary}
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {tip.node}
    </div>
  );
}

export function ClassSplit({ counts }: { counts: Record<string, number> }) {
  const tip = useTip();
  const order = ["possibly-deliberate", "likely-coverage-loss", "unknown"];
  const total = order.reduce((s, k) => s + (counts[k] ?? 0), 0);
  if (!total) return <p className="muted">No events in this window.</p>;
  const W = 520;
  let x = 0;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} 26`} width="100%" role="img">
        {order.map((k) => {
          const v = counts[k] ?? 0;
          if (!v) return null;
          const w = (v / total) * W - 2; // 2px surface gap between segments
          const seg = (
            <rect
              key={k}
              x={x}
              y={4}
              width={Math.max(2, w)}
              height={18}
              rx={4}
              fill={CLASS_COLORS[k]}
              onMouseMove={(e) =>
                tip.show(e, `${CLASS_LABELS[k]}: ${v} (${Math.round((v / total) * 100)}%)`)
              }
              onMouseLeave={tip.hide}
            />
          );
          x += w + 2;
          return seg;
        })}
      </svg>
      <div className="legend">
        {order.map((k) => (
          <span key={k} className="legend-item">
            <span className="swatch" style={{ background: CLASS_COLORS[k] }} />
            {CLASS_LABELS[k]}: {counts[k] ?? 0}
          </span>
        ))}
      </div>
      {tip.node}
    </div>
  );
}

export interface StripRun {
  startedAt: number;
  endedAt: number;
  degraded: boolean;
}

// Observation coverage over the last 48 h: when the collector was listening,
// when a region was degraded, and when nothing was collected at all.
export function CoverageStrip({ runs, now }: { runs: StripRun[]; now: number }) {
  const tip = useTip();
  const W = 520;
  const H = 30;
  const span = 48 * 3600;
  const from = now - span;
  const xOf = (t: number) => ((t - from) / span) * W;
  const visible = runs.filter((r) => r.endedAt > from);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img">
        <rect x={0} y={6} width={W} height={12} fill={INK.grid} rx={3} />
        {visible.map((r, i) => (
          <rect
            key={i}
            x={xOf(Math.max(r.startedAt, from))}
            y={6}
            width={Math.max(1.5, xOf(r.endedAt) - xOf(Math.max(r.startedAt, from)))}
            height={12}
            fill={r.degraded ? STATUS.degraded : STATUS.ok}
            onMouseMove={(e) =>
              tip.show(
                e,
                `${new Date(r.startedAt * 1000).toLocaleTimeString()} · ${r.degraded ? "degraded" : "healthy"}`,
              )
            }
            onMouseLeave={tip.hide}
          />
        ))}
        <text x={0} y={H} fontSize={10.5} fill={INK.secondary}>
          48 h ago
        </text>
        <text x={W} y={H} textAnchor="end" fontSize={10.5} fill={INK.secondary}>
          now
        </text>
      </svg>
      <div className="legend">
        <span className="legend-item">
          <span className="swatch" style={{ background: STATUS.ok }} />✓ collecting
        </span>
        <span className="legend-item">
          <span className="swatch" style={{ background: STATUS.degraded }} />⚠ degraded
        </span>
        <span className="legend-item">
          <span className="swatch" style={{ background: INK.grid }} />✕ no data
        </span>
      </div>
      {tip.node}
    </div>
  );
}
