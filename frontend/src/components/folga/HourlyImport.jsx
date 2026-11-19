import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DAYS } from "@/lib/api";
import { parseHourlyReport, singleWeekday, peakHours } from "@/lib/hourlyReport";
import { readText } from "@/lib/csvFile";

// Lê o relatório de vendas por horário (relatório 170, CSV ou Texto) e devolve a prévia para escolher o dia
export const readHourlyFile = async (file, fallbackDay) => {
  const periods = parseHourlyReport(await readText(file));
  if (!periods.length) return null;
  return { periods, key: periods[0].key, day: singleWeekday(periods[0]) ?? fallbackDay };
};

// Prévia do relatório lido: escolhe o período (se houver mais de um) e o dia da semana em que ele entra
export const ImportPreview = ({ preview, setPreview, onSave, saving }) => {
  const period = preview.periods.find((p) => p.key === preview.key);
  const total = period.hours.reduce((s, h) => s + h.clients, 0);
  const peaks = peakHours(period.hours);
  return (
    <div data-testid="hourly-import-preview" className="rounded-xl border border-[#E4E0F3] bg-[#F3F1FA] p-4 space-y-3">
      <p className="text-sm font-bold">Relatório lido: {period.hours.length} faixas de horário</p>
      {preview.periods.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {preview.periods.map((p) => (
            <button
              key={p.key}
              onClick={() => setPreview({ ...preview, key: p.key, day: singleWeekday(p) ?? preview.day })}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${p.key === preview.key ? "bg-[#17142E] border-[#17142E] text-white" : "bg-white border-[#E4E0F3] text-[#5E5880]"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-[#5E5880]">
        {preview.periods.length === 1 && <>{period.label} · </>}
        {Math.round(total)} clientes · pico em {peaks.length ? peaks.map((h) => `${h}h`).join(", ") : "—"}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-semibold">Usar como movimento de</label>
        <select
          value={preview.day}
          onChange={(e) => setPreview({ ...preview, day: Number(e.target.value) })}
          className="rounded-md border border-[#E4E0F3] bg-white px-2 py-1 text-xs"
        >
          {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>Cancelar</Button>
          <Button size="sm" disabled={saving} onClick={() => onSave(period, preview.day)} className="bg-[#17142E] hover:bg-[#2A2550] text-white">
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar
          </Button>
        </div>
      </div>
    </div>
  );
};
