import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageTitle } from "@/components/folga/Header";
import { WeekNav } from "@/components/folga/WeekNav";
import { http, errMsg, DAYS, DAYS_SHORT, DAY_SLUGS, SAMPLE_CSV, downloadFile } from "@/lib/api";
import { peakHours } from "@/lib/hourlyReport";

const todayIdx = () => (new Date().getDay() + 6) % 7;
const fmtN = (n) => Math.round(n || 0).toLocaleString("pt-BR");
const BTN = "inline-flex h-11 items-center gap-2 rounded-[22px] px-[18px] text-sm font-semibold";
const CHIP = "inline-flex h-[26px] shrink-0 items-center whitespace-nowrap rounded-[13px] px-2.5 text-xs font-semibold";
const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const joinPt = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`);

const Flame = () => (
  <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-5 1 1.5 2 2 2 2s-.5-4 1-7z" /></svg>
);

export const MovementPanel = ({ movement, onChange, week, onWeek }) => {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [day, setDay] = useState(todayIdx);
  const [hourly, setHourly] = useState([]);
  const peaks = movement?.peak_days || [];
  const hoursOf = (d) => hourly.find((h) => h.day === d)?.hours || [];

  useEffect(() => {
    http.get("/hourly", { params: { week } }).then(({ data }) => setHourly(data || [])).catch(() => setHourly([]));
  }, [week]);

  const onFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const { data: m } = await http.post("/movement/import", { week, csv: await file.text() });
      onChange(m);
      toast.success(`CSV importado para a semana de ${ddmm(week)}: ${m.total_records} registros`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
      fileRef.current.value = "";
    }
  };

  const togglePeak = async (d) => {
    const next = peaks.includes(d) ? peaks.filter((p) => p !== d) : [...peaks, d].sort();
    try {
      const { data: m } = await http.put("/movement/peaks", { week, peak_days: next });
      onChange(m);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  // Clientes por dia: média do histórico (CSV); sem histórico, a soma do relatório por hora do dia
  const totals = DAYS.map((_, i) => movement?.avg?.[i] || hoursOf(i).reduce((s, h) => s + (h.clients || 0), 0));
  const maxTotal = Math.max(1, ...totals);

  // Importação desta semana? Sem ela, o app usa a última importada e avisa
  const imported = !!movement?.source_week && movement.source_week === week;
  const hasData = (movement?.avg || []).some((v) => v > 0);
  const fromWeek = movement?.source_week ? `da semana de ${ddmm(movement.source_week)}` : "da importação antiga";
  const oldHourly = hourly.filter((h) => h.week !== week).map((h) => h.day);

  const all = hoursOf(day);
  const used = all.filter((h) => h.clients > 0).map((h) => h.hour);
  const hours = used.length ? all.filter((h) => h.hour >= Math.min(...used) && h.hour <= Math.max(...used)).sort((a, b) => a.hour - b.hour) : [];
  const max = Math.max(1, ...hours.map((h) => h.clients || 0));
  const pk = peakHours(all);

  return (
    <section data-testid="movement-dashboard" className="flex flex-col gap-5">
      <PageTitle
        eyebrow={imported ? `Movimento de clientes · ${fmtN(movement.total_records)} registros importados nesta semana` : "Movimento de clientes"}
        actions={
          <>
            {onWeek && <WeekNav week={week} onChange={onWeek} />}
            <button data-testid="btn-download-sample" onClick={() => downloadFile("modelo-movimento.csv", SAMPLE_CSV)} className={`${BTN} border border-[#E4E0F3] bg-white/80 text-[#1B1830]`}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6" /></svg>
              Baixar modelo
            </button>
            <button data-testid="btn-import-csv" disabled={busy} onClick={() => fileRef.current.click()} className={`${BTN} bg-[#6D5BD0] text-white hover:bg-[#5B4BC4]`}>
              {busy ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : (
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20V9M7 14l5-5 5 5M5 4h14" /></svg>
              )}
              Importar CSV
            </button>
            <input ref={fileRef} data-testid="csv-upload-input" type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files[0])} />
          </>
        }
      >
        Quando a casa <em>enche?</em>
      </PageTitle>

      {imported ? (
        <p data-testid="movement-week-status" className="m-0 rounded-2xl border border-[#BFE5D1] bg-[#E3F5EC] px-4 py-3 text-sm text-[#1D6B45]">
          <strong>Movimento desta semana importado</strong>{movement.updated_at ? ` em ${new Date(movement.updated_at).toLocaleDateString("pt-BR")}` : ""}. A escala desta semana usa estes números.
        </p>
      ) : (
        <p data-testid="movement-week-status" className="m-0 rounded-2xl border border-[#F2CF6B] bg-[#FFF9E6] px-4 py-3 text-sm text-[#7A5500]">
          <strong>Esta semana ainda não tem importação.</strong>{" "}
          {hasData ? `Enquanto isso, o app usa o movimento ${fromWeek}. ` : ""}Clique em <strong>Importar CSV</strong> para trazer o movimento desta semana.
        </p>
      )}

      <p className="m-0 text-sm text-[#4A4566]">Escolha um dia para ver as horas. Marque os <strong>dias de pico</strong>: o app evita dar folga neles.</p>

      <div data-testid="peak-days-field" className="grid gap-3 overflow-x-auto pb-1" style={{ gridTemplateColumns: "repeat(7, minmax(120px, 1fr))" }}>
        {DAYS.map((name, i) => {
          const on = peaks.includes(i);
          const sel = day === i;
          return (
            <div
              key={name}
              className="flex flex-col gap-2.5 rounded-[22px] border-[1.5px] p-4"
              style={sel ? { borderColor: "#6D5BD0", background: "#fff", boxShadow: "0 10px 30px -14px rgba(70,50,160,.45)" } : { borderColor: "#fff", background: "rgba(255,255,255,.75)" }}
            >
              <button onClick={() => setDay(i)} aria-label={`Ver horas de ${name}`} aria-pressed={sel} className="flex flex-col gap-2.5 text-left">
                <h3 className="m-0 font-display text-lg font-semibold">{DAYS_SHORT[i]}</h3>
                <span className="font-display text-[26px] font-semibold leading-none tracking-[-0.5px]">
                  {totals[i] ? fmtN(totals[i]) : "—"} <small className="font-sans text-xs font-medium tracking-normal text-[#5E5880]">clientes/dia</small>
                </span>
                <span className="block h-1.5 overflow-hidden rounded-[3px] bg-[#ECE8FB]">
                  <span className="block h-full rounded-[3px]" style={{ width: `${Math.round((totals[i] / maxTotal) * 100)}%`, background: on ? "#E0B13A" : "#6D5BD0" }} />
                </span>
              </button>
              <button
                type="button"
                aria-pressed={on}
                data-testid={`peak-day-indicator-${DAY_SLUGS[i]}`}
                onClick={() => togglePeak(i)}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-2xl border text-xs font-semibold"
                style={on ? { background: "#FFF4D1", borderColor: "#F2CF6B", color: "#7A5500" } : { background: "#fff", borderColor: "#E4E0F3", color: "#3A3555" }}
              >
                <Flame /> {on ? "Dia de pico" : "Marcar pico"}
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-5">
        <div className="min-w-0 rounded-[26px] border border-[#17142E] bg-[#17142E] p-[22px] text-white" style={{ flex: "3 1 560px" }}>
          <div className="mb-9 flex flex-wrap items-center justify-between gap-2.5">
            <div>
              <p className="m-0 text-[13px] text-[#C9C4E6]">Clientes por hora</p>
              <h2 className="mt-1 font-display text-[26px] font-semibold">{DAYS[day]}</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {hours.length > 0 && oldHourly.includes(day) && (
                <span className={`${CHIP} bg-[#3A3463] text-[#E9E6F8]`}>
                  {hourly.find((h) => h.day === day)?.week ? `Da semana de ${ddmm(hourly.find((h) => h.day === day).week)}` : "Importação antiga"}
                </span>
              )}
              {pk.length > 0 && <span className={`${CHIP} bg-[#F2CF6B] text-[#3A2A00]`}>Atenção · pico {joinPt(pk.map((h) => `${h}h`))}</span>}
            </div>
          </div>
          {!hours.length ? (
            <p className="py-16 text-center text-sm text-[#C9C4E6]">Sem movimento por hora para {DAYS[day].toLowerCase()} nesta semana. Importe o relatório por hora na sub-aba de horários da Escala.</p>
          ) : (
            <>
              <div className="flex h-[240px] items-end gap-[3px] sm:gap-2">
                {hours.map((h) => {
                  const v = h.clients || 0;
                  const bg = pk.includes(h.hour) ? "#F2C94C" : v / max > 0.6 ? "#7C6AE0" : "#3A3463";
                  return (
                    <div key={h.hour} title={`${h.hour}h · ${fmtN(v)} clientes`} className="relative flex flex-1 justify-center rounded-t-[10px] rounded-b-md" style={{ height: `${Math.max(2, Math.round((v / max) * 100))}%`, background: bg }}>
                      <span className="absolute -top-5 hidden font-display text-[11px] font-semibold text-[#E9E6F8] sm:block">{v ? fmtN(v) : ""}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex gap-[3px] sm:gap-2">
                {hours.map((h) => <span key={h.hour} className="flex-1 text-center text-[11px] text-[#A9A3C9]">{h.hour}h</span>)}
              </div>
            </>
          )}
        </div>

        <div className="glass flex min-w-0 flex-col gap-3.5 rounded-[26px] p-[22px]" style={{ flex: "2 1 300px" }}>
          <h2 className="m-0 text-lg font-bold">O que o app faz com isso</h2>
          {[
            ["bg-[#FFF4D1] text-[#7A5500]", `Nos dias de pico (${peaks.length ? peaks.map((d) => DAYS_SHORT[d]).join(", ") : "nenhum marcado"}) ninguém folga, a não ser que não haja outro jeito.`],
            ["bg-[#EEEBFB] text-[#4B3DA8]", "Nos horários de pico, a aba Caixas mostra quantos caixas precisam estar abertos."],
            ["bg-[#E3F5EC] text-[#1D6B45]", "Toda semana, importe o CSV do PDV e o relatório por hora: cada semana guarda o seu movimento e os picos são sugeridos sozinhos."],
          ].map(([cls, txt], i) => (
            <div key={i} className="flex items-start gap-3">
              <span className={`${CHIP} ${cls}`}>{i + 1}</span>
              <p data-testid={i === 0 ? "peak-days-summary" : undefined} className="m-0 text-sm text-[#3A3555]">{txt}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
