"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type HistoryPoint = { label: string; goals: number; assists: number };

/** Góly a asistencie hráča zápas po zápase. */
export function PlayerHistoryChart({ data, nickname }: { data: HistoryPoint[]; nickname: string }) {
  return (
    <div className="h-48 w-full" role="img" aria-label={`Góly a asistencie hráča ${nickname} v jednotlivých zápasoch`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -26 }} barCategoryGap="22%">
          <CartesianGrid stroke="rgba(245,247,243,0.06)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "#8D9990", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={16} />
          <YAxis allowDecimals={false} tick={{ fill: "#8D9990", fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{ background: "#1B241F", border: "1px solid rgba(245,247,243,0.16)", borderRadius: 12, fontSize: 13 }}
            labelStyle={{ color: "#8D9990" }}
            itemStyle={{ color: "#F5F7F3" }}
            cursor={{ fill: "rgba(245,247,243,0.04)" }}
          />
          <Bar dataKey="goals" name="Góly" stackId="s" fill="#B7F36B" maxBarSize={28} />
          <Bar dataKey="assists" name="Asistencie" stackId="s" fill="#5AA9C9" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
