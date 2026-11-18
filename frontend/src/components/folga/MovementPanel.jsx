import { useEffect, useRef, useState } from "react";
import { Upload, FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PageTitle } from "@/components/folga/Header";
import { http, errMsg, DAYS, DAY_SLUGS, SAMPLE_CSV, downloadFile } from "@/lib/api";
import { peakHours } from "@/lib/hourlyReport";

const todayIdx = () => (new Date().getDay() + 6) % 7;
const fmtN = (n) => Math.round(n || 0).toLocaleString("pt-BR");

const HourChart = ({ day, hours }) => {
  const list = (hours || []).filter((h) => h.clients > 0);
  const peaks = peakHours(hours || []);
  const max = Math.max(1, ...list.map((h) => h.clients));
  const peakLabel = peaks.length ? peaks.map((h) => `${h}h`).join(peaks.length === 2 ? " e " : ", ") : null;
  return (
    <div className="rounded-[26px] bg-[#17142E] p-5 text-white sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold">Clientes por hora · {DAYS[day]}</h3>
        {peakLabel && (
          <span className="rounded-full bg-[#FFF4D1] px-3 py-1 text-xs font-bold text-[#7A5500]">Atenção · pico {peakLabel}</span>
        )}
      </div>
      {!list.length ? (
        <p className="py-10 text-center text-sm text-white/60">
          Sem movimento por hora para {DAYS[day].toLowerCase()}. Importe o relatório por hora na sub-aba de horários da Escala.
        </p>
      ) : (
        <div className="flex h-[200px] items-end gap-1.5 sm:gap-2">
          {list.map((h) => {
            const pk = peaks.includes(h.hour);
            return (
              <div key={h.hour} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5 h-full" title={`${h.hour}h · ${fmtN(h.clients)} clientes`}>
                <span className={`font-mono-data text-[10px] ${pk ? "font-bold text-[#F2C94C]" : "text-white/60"}`}>{fmtN(h.clients)}</span>
                <div className="w-full rounded-t-md" style={{ height: `${(h.clients / max) * 150}px`, background: pk ? "#F2C94C" : "#7C6AE0" }} />
                <span className="font-mono-data text-[10px] text-white/70">{h.hour}h</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const MovementPanel = ({ movement, onChange }) => {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [day, setDay] = useState(todayIdx);
  const [hourly, setHourly] = useState([]);
  const peaks = movement?.peak_days || [];
  const avg = movement?.avg || [];
  const max = Math.max(1, ...avg.map((v) => v || 0));

  useEffect(() => {
    http.get("/hourly").then(({ data }) => setHourly(data || [])).catch(() => setHourly([]));
  }, []);

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

  const hoursOf = (d) => hourly.find((h) => h.day === d)?.hours || [];

  return (
    <section data-testid="movement-dashboard" className="space-y-5">
      <PageTitle
        eyebrow={movement?.total_records ? `Movimento de clientes · ${fmtN(movement.total_records)} registros importados` : "Movimento de clientes · nenhum histórico importado"}
        actions={
          <>
            <Button data-testid="btn-download-sample" variant="outline" onClick={() => downloadFile("modelo-movimento.csv", SAMPLE_CSV)} className="h-11 rounded-full border-[#E4E0F3] bg-white/80 px-[18px]">
              <FileDown className="mr-2 h-4 w-4" /> Baixar modelo
            </Button>
            <Button data-testid="btn-import-csv" disabled={busy} onClick={() => fileRef.current.click()} className="h-11 rounded-full bg-[#6D5BD0] px-[18px] text-white hover:bg-[#5B4BC4]">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />} Importar CSV
            </Button>
            <input ref={fileRef} data-testid="csv-upload-input" type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files[0])} />
          </>
        }
      >
        Quando a casa <em>enche?</em>
      </PageTitle>

      <p className="text-sm text-[#5E5880]">Escolha um dia para ver as horas. Marque os dias de pico: o app evita dar folga neles.</p>

      <div data-testid="peak-days-field" className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {DAYS.map((d, i) => {
          const on = peaks.includes(i);
          const sel = day === i;
          const v = avg[i] || 0;
          return (
            <div
              key={d}
              role="button"
              tabIndex={0}
              onClick={() => setDay(i)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setDay(i)}
              className={`glass cursor-pointer rounded-[22px] p-4 transition ${sel ? "ring-2 ring-[#6D5BD0]" : "hover:ring-1 hover:ring-[#C9BFFF]"}`}
            >
              <p className="text-sm font-bold">{d}</p>
              <p className="mt-1 font-display text-2xl font-bold tracking-tight">{v ? fmtN(v) : "—"}</p>
              <p className="text-[11px] text-[#5E5880]">clientes/dia</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#F2F0F8]">
                <div className="h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: on ? "#F2C94C" : "#7C6AE0" }} />
              </div>
              <button
                type="button"
                aria-pressed={on}
                data-testid={`peak-day-indicator-${DAY_SLUGS[i]}`}
                onClick={(e) => {
                  e.stopPropagation();
                  togglePeak(i);
                }}
                className={`mt-3 w-full rounded-full border px-2 py-1.5 text-xs font-bold transition ${
                  on ? "border-[#F2CF6B] bg-[#FFF4D1] text-[#7A5500]" : "border-[#E4E0F3] bg-white text-[#5E5880] hover:border-[#F2CF6B] hover:text-[#7A5500]"
                }`}
              >
                {on ? "Dia de pico" : "Marcar pico"}
              </button>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
        <HourChart day={day} hours={hoursOf(day)} />
        <div className="glass rounded-[26px] p-5 sm:p-6">
          <h3 className="mb-4 text-base font-bold">O que o app faz com isso</h3>
          <ol className="space-y-4">
            {[
              ["Evita folga nos dias de pico", "Na hora de gerar a escala, as folgas vão para os dias mais calmos."],
              ["Mostra os horários de pico", "As horas mais cheias aparecem em amarelo aqui e na sub-aba de horários da Escala."],
              ["Avisa quando falta gente", "Na Escala, o dia com pouca gente na loja aparece em amarelo ou vermelho."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#E6E1FA] text-sm font-bold text-[#4B3DA8]">{i + 1}</span>
                <div>
                  <p className="text-sm font-semibold">{t}</p>
                  <p className="text-xs text-[#5E5880]">{d}</p>
                </div>
              </li>
            ))}
          </ol>
          <p data-testid="peak-days-summary" className="mt-5 text-xs text-[#5E5880]">
            {peaks.length ? <>Dias de pico: <b className="text-[#7A5500]">{peaks.map((p) => DAYS[p]).join(", ")}</b></> : "Nenhum dia de pico marcado."}
          </p>
        </div>
      </div>
    </section>
  );
};
