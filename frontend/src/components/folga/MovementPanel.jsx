import { useRef, useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Flame, Upload, FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { http, errMsg, DAYS, DAYS_SHORT, DAY_SLUGS, SAMPLE_CSV, downloadFile } from "@/lib/api";

const PeakToggles = ({ peaks, onToggle }) => (
  <div className="grid grid-cols-7 gap-2">
    {DAYS_SHORT.map((d, i) => {
      const on = peaks.includes(i);
      return (
        <button
          key={d}
          data-testid={`peak-day-indicator-${DAY_SLUGS[i]}`}
          onClick={() => onToggle(i)}
          title={`${on ? "Remover" : "Marcar"} ${DAYS[i]} como pico`}
          className={`rounded-lg border py-2 text-xs font-bold uppercase transition-colors duration-200 flex flex-col items-center gap-1 ${
            on ? "peak-pulse bg-[#DC2626] border-[#DC2626] text-white" : "bg-white border-[#E5E1D8] text-[#575E65] hover:border-[#DC2626] hover:text-[#DC2626]"
          }`}
        >
          <Flame className="h-3.5 w-3.5" />{d}
        </button>
      );
    })}
  </div>
);

export const MovementPanel = ({ movement, onChange }) => {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const peaks = movement?.peak_days || [];
  const data = DAYS_SHORT.map((d, i) => ({ day: d, clientes: movement?.avg?.[i] || 0, peak: peaks.includes(i) }));

  const onFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const { data: m } = await http.post("/movement/import", { csv: await file.text() });
      onChange(m);
      toast.success(`CSV importado: ${m.total_records} registros`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
      fileRef.current.value = "";
    }
  };

  const togglePeak = async (d) => {
    const next = peaks.includes(d) ? peaks.filter((p) => p !== d) : [...peaks, d];
    try {
      const { data: m } = await http.put("/movement/peaks", { peak_days: next });
      onChange(m);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <section data-testid="movement-dashboard" className="rounded-2xl border border-[#E5E1D8] bg-white p-5 sm:p-6 h-full">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#8A929B]">Histórico de movimento</p>
          <h3 className="font-display text-2xl font-bold tracking-tight mt-1">Média de clientes por dia</h3>
          <p data-testid="movement-records" className="text-xs text-[#575E65] mt-1">
            {movement?.total_records ? `${movement.total_records} registros importados` : "Nenhum histórico importado ainda"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button data-testid="btn-download-sample" variant="ghost" size="sm" onClick={() => downloadFile("modelo-movimento.csv", SAMPLE_CSV)} className="hover:bg-[#F2EFE8] hover:text-[#191C1E]">
            <FileDown className="h-4 w-4 mr-1" /> Modelo
          </Button>
          <Button data-testid="btn-import-csv" size="sm" disabled={busy} onClick={() => fileRef.current.click()} className="bg-[#0F172A] hover:bg-[#1E293B] text-white">
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />} Importar CSV
          </Button>
          <input ref={fileRef} data-testid="csv-upload-input" type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files[0])} />
        </div>
      </div>
      <div data-testid="movement-chart-container" className="h-48 -ml-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#575E65" }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8A929B" }} width={40} />
            <Tooltip cursor={{ fill: "#F2EFE8" }} formatter={(v) => [`${v} clientes`, "Média"]} />
            <Bar dataKey="clientes" radius={[6, 6, 0, 0]}>
              {data.map((d) => <Cell key={d.day} fill={d.peak ? "#E65100" : "#CBD5E1"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs font-semibold text-[#575E65] mt-4 mb-2">Dias de pico (clique para marcar/desmarcar) — o app evita folgas nesses dias:</p>
      <PeakToggles peaks={peaks} onToggle={togglePeak} />
    </section>
  );
};
