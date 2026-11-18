import { useRef, useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Flame, Upload, FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { http, errMsg, DAYS, DAYS_SHORT, DAY_SLUGS, SAMPLE_CSV, downloadFile } from "@/lib/api";

const PeakField = ({ peaks, onToggle }) => (
  <div data-testid="peak-days-field" className="rounded-xl border border-[#EE9A9A] bg-[#FDECEC]/60 p-4 mb-6">
    <label className="flex items-center gap-2 text-sm font-bold text-[#1B1830]">
      <Flame className="h-4 w-4 text-[#C93C3C]" /> Dias de maior movimento
    </label>
    <p className="text-xs text-[#5E5880] mt-1 mb-3">Selecione os dias manualmente. O app evita folgas nesses dias.</p>
    <div className="grid grid-cols-4 sm:grid-cols-7 lg:grid-cols-4 2xl:grid-cols-7 gap-2">
      {DAYS.map((d, i) => {
        const on = peaks.includes(i);
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            data-testid={`peak-day-indicator-${DAY_SLUGS[i]}`}
            onClick={() => onToggle(i)}
            className={`rounded-lg border px-2 py-2.5 text-xs font-bold transition-colors duration-200 flex items-center justify-center gap-1.5 ${
              on ? "peak-pulse bg-[#C93C3C] border-[#C93C3C] text-white" : "bg-white border-[#E4E0F3] text-[#5E5880] hover:border-[#C93C3C] hover:text-[#C93C3C]"
            }`}
          >
            <span className={`h-3.5 w-3.5 rounded border grid place-items-center ${on ? "bg-white border-white" : "border-[#D6D0EE]"}`}>
              {on && <span className="h-1.5 w-1.5 rounded-sm bg-[#C93C3C]" />}
            </span>
            <span>{DAYS_SHORT[i]}</span>
          </button>
        );
      })}
    </div>
    <p data-testid="peak-days-summary" className="text-xs mt-3 text-[#5E5880]">
      {peaks.length ? <>Selecionados: <b className="text-[#C93C3C]">{peaks.map((p) => DAYS[p]).join(", ")}</b></> : "Nenhum dia selecionado."}
    </p>
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
    <section data-testid="movement-dashboard" className="glass rounded-[26px] p-5 sm:p-6 h-full">
      <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#8A85A3]">Movimento de clientes</p>
      <h3 className="font-display text-2xl font-bold tracking-tight mt-1 mb-4">Quando a casa enche?</h3>
      <PeakField peaks={peaks} onToggle={togglePeak} />
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-sm font-bold">Ou importe o histórico (opcional)</p>
          <p className="text-xs text-[#5E5880] mt-0.5">O CSV calcula a média por dia e sugere os picos automaticamente.</p>
          <p data-testid="movement-records" className="text-xs text-[#5E5880] mt-1">
            {movement?.total_records ? `${movement.total_records} registros importados` : "Nenhum histórico importado ainda"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button data-testid="btn-download-sample" variant="ghost" size="sm" onClick={() => downloadFile("modelo-movimento.csv", SAMPLE_CSV)} className="hover:bg-[#EEEBFB] hover:text-[#1B1830]">
            <FileDown className="h-4 w-4 mr-1" /> Modelo
          </Button>
          <Button data-testid="btn-import-csv" size="sm" disabled={busy} onClick={() => fileRef.current.click()} className="bg-[#17142E] hover:bg-[#2A2550] text-white">
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />} Importar CSV
          </Button>
          <input ref={fileRef} data-testid="csv-upload-input" type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files[0])} />
        </div>
      </div>
      <div data-testid="movement-chart-container" className="h-48 -ml-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#5E5880" }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#8A85A3" }} width={40} />
            <Tooltip cursor={{ fill: "#EEEBFB" }} formatter={(v) => [`${v} clientes`, "Média"]} />
            <Bar dataKey="clientes" radius={[6, 6, 0, 0]}>
              {data.map((d) => <Cell key={d.day} fill={d.peak ? "#E65100" : "#CBD5E1"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
};
