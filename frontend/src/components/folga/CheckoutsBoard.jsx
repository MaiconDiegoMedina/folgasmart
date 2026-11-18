import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { DAYS_SHORT, weekDates, fmtDayMonth, isoDate, http, errMsg } from "@/lib/api";
import { peakHours } from "@/lib/hourlyReport";
import { defaultShiftOf, toMin, dayMinutes } from "@/lib/workloadTimes";
import { isIntermittent, acceptedOn } from "@/lib/convocation";

const START = 6 * 60;
const END = 24 * 60;
const SPAN = END - START;
const HOURS = Array.from({ length: (END - START) / 60 }, (_, i) => 6 + i);
const pct = (m) => `${(((m - START) / SPAN) * 100).toFixed(2)}%`;
const width = (a, b) => `${(((b - a) / SPAN) * 100).toFixed(2)}%`;
const fmtDur = (m) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;

const LVL = {
  ok: { bar: "bg-[#BFE6D1] text-[#1D6B45]", tile: "bg-[#E3F5EC] border-[#8FD0AE]", ink: "text-[#1D6B45]", avatar: "bg-[#BFE6D1] text-[#1D6B45]" },
  warn: { bar: "bg-[#F7DC8A] text-[#5C4000]", tile: "bg-[#FFF4D1] border-[#F2CF6B]", ink: "text-[#7A5500]", avatar: "bg-[#F7DC8A] text-[#5C4000]" },
  risk: { bar: "bg-[#F4B4B4] text-[#8A1F1F]", tile: "bg-[#FDE2E2] border-[#EE9A9A]", ink: "text-[#A12828]", avatar: "bg-[#F4B4B4] text-[#8A1F1F]" },
};
const initials = (n) => n.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

// Frente de caixa: posição de cada operadora por caixa ao longo do dia
export const CheckoutsBoard = ({ employees, schedule, week, workloads, sectorModes = {}, checkouts }) => {
  const dates = weekDates(week);
  const todayIdx = dates.findIndex((d) => isoDate(d) === isoDate(new Date()));
  const [day, setDay] = useState(todayIdx >= 0 ? todayIdx : 0);
  const [assign, setAssign] = useState({});
  const [shifts, setShifts] = useState({});
  const [hourly, setHourly] = useState([]);
  const [picking, setPicking] = useState(null);
  const loadAssign = useCallback(() => {
    http.get("/checkouts/assign/week", { params: { week } }).then(({ data }) => setAssign(data)).catch(() => setAssign({}));
  }, [week]);
  useEffect(() => {
    loadAssign();
    http.get("/shifts/week", { params: { week } }).then(({ data }) => setShifts(data)).catch(() => setShifts({}));
  }, [week, loadAssign]);
  useEffect(() => {
    http.get("/hourly").then(({ data }) => setHourly(data || [])).catch(() => setHourly([]));
  }, []);

  const allocate = async (employee_id, checkout_id) => {
    setPicking(null);
    try {
      await http.put("/checkouts/assign", { week, day, employee_id, checkout_id });
      loadAssign();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const has = (key, id, d) => (schedule[key]?.[id] || []).includes(d);
  const modeOf = (sector) => {
    const used = Object.entries(schedule.sector_modes || {}).find(([k]) => k.toLowerCase() === (sector || "").toLowerCase());
    return used?.[1] || sectorModes[(sector || "").toLowerCase()] || "6x1";
  };
  const works = (e, d) => {
    if ((schedule.closed_days || []).includes(d) || has("vacation_days", e.id, d) || has("sick_days", e.id, d)) return false;
    if (isIntermittent(e)) return acceptedOn(schedule, e.id, d);
    return (!has("off_days", e.id, d) || has("extra_days", e.id, d)) && !has("suspension_days", e.id, d) && !has("absence_days", e.id, d);
  };
  const shiftOf = (e, d) =>
    shifts[String(d)]?.[e.id] || (isIntermittent(e) ? null : defaultShiftOf(workloads.find((w) => w.id === e.workload), modeOf(e.sector), d));

  const { rows, loose, cover } = useMemo(() => {
    const dayAssign = assign[String(day)] || {};
    const op = (e) => {
      const s = shiftOf(e, day);
      const streak = (schedule.streak_alerts?.[e.id] || []).includes(day);
      const extra = has("extra_days", e.id, day);
      const lvl = streak ? "risk" : extra ? "warn" : "ok";
      const note = streak ? "Risco: passou de 6 dias seguidos" : extra ? "Extra: trabalha no dia de folga" : "Na jornada";
      return {
        emp: e, shift: s, lvl, note,
        a: s ? toMin(s[0]) : null,
        b: s ? toMin(s[s.length - 1]) : null,
        brk: s && s.length === 4 ? [toMin(s[1]), toMin(s[2])] : null,
        daily: s ? `${fmtDur(dayMinutes(s))} por dia` : "sem horário",
        contract: e.contract || (isIntermittent(e) ? "intermitente" : "efetivo"),
      };
    };
    const onDay = employees.filter((e) => works(e, day));
    const rows = checkouts.map((c) => ({
      ...c,
      ops: onDay.filter((e) => dayAssign[e.id] === c.id).map(op).sort((x, y) => (x.a ?? 0) - (y.a ?? 0)),
    }));
    const loose = onDay.filter((e) => /caixa/i.test(e.sector || "") && !dayAssign[e.id]).map(op);
    const cover = HOURS.map((h) => {
      const t = h * 60 + 30;
      return rows.filter((r) => r.ops.some((o) => o.a !== null && o.a <= t && o.b > t)).length;
    });
    return { rows, loose, cover };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assign, shifts, day, employees, checkouts, schedule, workloads, sectorModes]);

  const nowMin = todayIdx === day ? new Date().getHours() * 60 + new Date().getMinutes() : null;
  const maxCover = Math.max(1, checkouts.length);

  // Meta por hora estimada pelo movimento: a hora mais cheia do dia pede todos os caixas
  const dayHours = hourly.find((h) => h.day === day)?.hours || [];
  const peakMax = Math.max(0, ...dayHours.map((h) => h.clients || 0));
  const need = HOURS.map((h) => {
    const c = dayHours.find((x) => x.hour === h)?.clients || 0;
    return peakMax && c && checkouts.length ? Math.max(1, Math.ceil((c / peakMax) * checkouts.length)) : null;
  });
  const hasNeed = need.some((n) => n !== null);
  const lvlOf = (n, t) => (t === null ? null : n >= t ? "ok" : n >= t * 0.75 ? "warn" : "risk");
  const BAR_BG = { ok: "#8FD0AE", warn: "#F2C94C", risk: "#EE9A9A" };
  const peaks = peakHours(dayHours).filter((h) => HOURS.includes(h)).sort((a, b) => a - b);
  const peakIdx = peaks.map((h) => HOURS.indexOf(h));
  const peakOpen = peakIdx.length && hasNeed ? Math.min(...peakIdx.map((i) => cover[i])) : null;
  const peakNeed = peakIdx.length ? Math.max(...peakIdx.map((i) => need[i] || 0)) : null;
  const peakLabel = peaks.length ? `${peaks[0]}h–${peaks[peaks.length - 1] + 1}h` : "";
  const TURNOS = [["Manhã", 6, 12], ["Tarde", 12, 18], ["Noite", 18, 24]];
  const turnos = TURNOS.map(([name, a, b]) => {
    const idx = HOURS.map((h, i) => (h >= a && h < b && need[i] !== null ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return { name, lvl: null };
    const short = idx.filter((i) => cover[i] < need[i]).length;
    const worst = idx.reduce((w, i) => Math.min(w, cover[i] / need[i]), 1);
    return { name, lvl: !short ? "ok" : worst >= 0.75 ? "warn" : "risk", short };
  });
  const CHIP = { ok: "bg-[#E3F5EC] text-[#1D6B45]", warn: "bg-[#FFF4D1] text-[#7A5500]", risk: "bg-[#FDE2E2] text-[#A12828]" };

  const Bar = ({ o, where }) =>
    o.a === null ? null : (
      <>
        <div
          title={`${o.emp.name} · ${where} · ${o.shift[0]} às ${o.shift[o.shift.length - 1]}${o.brk ? ` · intervalo ${o.shift[1]}–${o.shift[2]}` : ""} · ${o.note}`}
          className={`absolute top-[3px] bottom-[3px] flex items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[10px] px-2 text-xs font-semibold ${where === "sem caixa" ? "border-[1.5px] border-dashed border-[#B9B2DA] bg-white/60 text-[#4B3DA8]" : LVL[o.lvl].bar}`}
          style={{ left: pct(Math.max(o.a, START)), width: `calc(${width(Math.max(o.a, START), Math.min(o.b, END))} - 2px)` }}
        >
          {o.emp.name.split(" ")[0]}
          {o.b - o.a >= 300 && <i className="not-italic text-[11px] font-medium opacity-80">{o.shift[0]}–{o.shift[o.shift.length - 1]}</i>}
        </div>
        {o.brk && (
          <div
            title={`Intervalo de ${o.emp.name.split(" ")[0]} · ${o.shift[1]}–${o.shift[2]}`}
            className="absolute top-[3px] bottom-[3px]"
            style={{ left: pct(o.brk[0]), width: width(o.brk[0], o.brk[1]), background: "repeating-linear-gradient(135deg,rgba(255,255,255,.9) 0 3px,rgba(255,255,255,.35) 3px 6px)" }}
          />
        )}
      </>
    );

  const track = "relative h-[34px] rounded-xl";
  const trackStyle = { background: "repeating-linear-gradient(90deg,rgba(94,88,128,.10) 0 1px,transparent 1px calc(100% / 18)),rgba(255,255,255,.55)" };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Dia">
        {DAYS_SHORT.map((d, i) => (
          <button
            key={d}
            onClick={() => setDay(i)}
            className={`h-[38px] rounded-full border px-4 text-sm font-medium ${day === i ? "border-[#17142E] bg-[#17142E] text-white" : "border-[#E4E0F3] bg-white/75 text-[#3A3555]"}`}
          >
            {d} {fmtDayMonth(dates[i])}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-5">
      <section className="glass rounded-[26px] p-5 sm:p-6" aria-label="Posição dos caixas ao longo do dia">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Posição dos caixas no dia</h2>
            <p className="mt-1 text-[13px] text-[#5E5880]">Cada barra é uma operadora no seu caixa. Parte listrada = intervalo. Passe o mouse para ver o horário.</p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-[#4A4566]">
            <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-[#BFE6D1]" />Na jornada</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-[#F7DC8A]" />Extra</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-[#F4B4B4]" />+6 dias seguidos</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded border-[1.5px] border-dashed border-[#B9B2DA]" />Sem caixa</span>
          </div>
        </div>
        {checkouts.length === 0 ? (
          <p className="py-6 text-sm text-[#5E5880]">Cadastre os caixas abaixo para ver a posição de cada operadora.</p>
        ) : (
          <div className="-mx-1.5 overflow-x-auto px-1.5 pb-1 pt-2.5">
            <div className="flex min-w-[820px] flex-col gap-1.5">
              <div className="grid grid-cols-[110px_1fr] items-center gap-2.5">
                <span />
                <div className="grid grid-cols-[repeat(18,1fr)] font-mono-data text-[11px] text-[#5E5880]">{HOURS.map((h) => <span key={h}>{String(h).padStart(2, "0")}h</span>)}</div>
              </div>
              {rows.map((r) => (
                <div key={r.id} className="grid grid-cols-[110px_1fr] items-center gap-2.5">
                  <div className="truncate font-display text-[13px] font-semibold">
                    {r.name}
                    <small className="block font-sans text-[11px] font-medium text-[#5E5880]">{r.ops.length ? `${r.ops.length} ${r.ops.length > 1 ? "turnos" : "turno"}` : "livre"}</small>
                  </div>
                  <div className={track} style={trackStyle}>
                    {nowMin !== null && nowMin > START && <div className="absolute -top-1.5 -bottom-1.5 z-[2] w-0.5 rounded bg-[#6D5BD0]" style={{ left: pct(nowMin) }} />}
                    {r.ops.map((o) => <Bar key={o.emp.id} o={o} where={r.name} />)}
                  </div>
                </div>
              ))}
              {loose.length > 0 && (
                <div className="grid grid-cols-[110px_1fr] items-center gap-2.5">
                  <div className="font-display text-[13px] font-semibold">Sem caixa<small className="block font-sans text-[11px] font-medium text-[#5E5880]">{loose.length} pessoa(s)</small></div>
                  <div className="relative h-[34px] rounded-xl border border-dashed border-[#D6D0EE]">{loose.map((o) => <Bar key={o.emp.id} o={o} where="sem caixa" />)}</div>
                </div>
              )}
              <div className="mt-4 grid grid-cols-[110px_1fr] items-end gap-2.5">
                <div className="font-display text-[13px] font-semibold">Abertos<small className="block font-sans text-[11px] font-medium text-[#5E5880]">{hasNeed ? "por hora / meta" : "por hora"}</small></div>
                <div className="grid h-16 grid-cols-[repeat(18,1fr)] items-end gap-1">
                  {cover.map((n, i) => {
                    const l = lvlOf(n, need[i]);
                    return (
                      <div
                        key={i}
                        title={`${String(HOURS[i]).padStart(2, "0")}h: ${n} ${n === 1 ? "caixa aberto" : "caixas abertos"}${need[i] !== null ? ` · meta ${need[i]}` : ""}`}
                        className="relative flex justify-center rounded-t-md rounded-b-sm"
                        style={{ height: `${Math.max(6, (n / maxCover) * 100)}%`, background: l ? BAR_BG[l] : "#C9BFFF" }}
                      >
                        <b className="absolute -top-4 whitespace-nowrap font-mono-data text-[11px] text-[#4B3DA8]">{need[i] !== null ? `${n}/${need[i]}` : n}</b>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {checkouts.length > 0 && (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-col gap-3.5 rounded-[22px] border border-white bg-white/80 p-[18px] shadow-[0_10px_30px_-20px_rgba(70,50,160,0.25)]">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold">{r.name}</h3>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${r.ops.length >= 2 ? "bg-[#E3F5EC] text-[#1D6B45]" : r.ops.length === 1 ? "bg-[#FFF4D1] text-[#7A5500]" : "bg-[#F2F0F8] text-[#4A4566]"}`}>
                  {r.ops.length >= 2 ? `Aberto · ${r.ops.length} turnos` : r.ops.length === 1 ? "Aberto · 1 turno" : "Livre"}
                </span>
              </div>
              {r.ops.length === 0 ? (
                <p className="rounded-[14px] border-[1.5px] border-dashed border-[#D6D0EE] px-3 py-3 text-center text-[13px] font-semibold text-[#4B3DA8]">Escolha a operadora na sub-aba de horários do dia da Escala</p>
              ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  {r.ops.map((o) => (
                    <div key={o.emp.id} title={`${o.emp.name} · ${o.shift ? `${o.shift[0]} às ${o.shift[o.shift.length - 1]}` : "sem horário"} · ${o.note}`} className={`flex items-start gap-2.5 rounded-[14px] border-[1.5px] p-2 ${LVL[o.lvl].tile}`}>
                      <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold ${LVL[o.lvl].avatar}`}>{initials(o.emp.name)}</div>
                      <div className="min-w-0 text-[13px] font-semibold">
                        <span className="block truncate">{o.emp.name}</span>
                        <small className="block text-xs font-medium text-[#5E5880]">{o.daily}</small>
                        <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.04em] text-[#8A85A3]">{o.contract}</span>
                        <span className={`mt-1 block text-[11px] font-bold ${LVL[o.lvl].ink}`}>{o.lvl === "ok" ? "Na jornada" : o.lvl === "warn" ? "Extra" : "+6 dias"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      )}
      </div>
      <aside className="space-y-4">
        {peakOpen !== null && (
          <div className={`rounded-[22px] border-[1.5px] p-5 ${peakOpen >= peakNeed ? "border-[#8FD0AE] bg-[#E3F5EC] text-[#1D6B45]" : "border-[#EE9A9A] bg-[#FDE2E2] text-[#A12828]"}`}>
            <p className="text-sm font-semibold">Caixas no horário de pico ({peakLabel})</p>
            <p className="mt-1 font-display text-3xl font-bold">{peakOpen} <span className="text-base font-semibold">de {peakNeed} necessários</span></p>
          </div>
        )}
        <div className="glass rounded-[22px] p-5">
          <h3 className="mb-3 text-base font-bold">Cobertura do dia por turno</h3>
          {!hasNeed ? (
            <p className="text-[13px] text-[#5E5880]">Importe o movimento por hora deste dia na sub-aba de horários da Escala para ver a meta de caixas.</p>
          ) : (
            <ul className="space-y-2">
              {turnos.map((t) => (
                <li key={t.name} className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{t.name}</span>
                  {t.lvl ? (
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${CHIP[t.lvl]}`}>
                      {t.lvl === "ok" ? "Ok · meta batida" : `Falta caixa em ${t.short}h`}
                    </span>
                  ) : (
                    <span className="text-xs text-[#8A85A3]">sem movimento</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="glass rounded-[22px] p-5">
          <h3 className="mb-3 text-base font-bold">Trabalhando sem caixa</h3>
          {loose.length === 0 ? (
            <p className="text-[13px] text-[#5E5880]">Todo mundo do caixa que trabalha neste dia já tem um caixa.</p>
          ) : (
            <ul className="space-y-2.5">
              {loose.map((o) => (
                <li key={o.emp.id} className="flex items-center gap-2.5">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#E6E1FA] text-[11px] font-bold text-[#4B3DA8]">{initials(o.emp.name)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{o.emp.name}</p>
                    <p className="text-xs text-[#5E5880]">{o.shift ? `${o.shift[0]}–${o.shift[o.shift.length - 1]}` : "sem horário"}</p>
                  </div>
                  {picking === o.emp.id ? (
                    <select autoFocus aria-label={`Caixa de ${o.emp.name}`} defaultValue="" onBlur={() => setPicking(null)} onChange={(e) => e.target.value && allocate(o.emp.id, e.target.value)} className="h-8 rounded-full border border-[#E4E0F3] bg-white px-2 text-xs">
                      <option value="" disabled>Caixa…</option>
                      {checkouts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  ) : (
                    <button disabled={!checkouts.length} onClick={() => setPicking(o.emp.id)} className="h-8 rounded-full bg-[#6D5BD0] px-3 text-xs font-semibold text-white hover:bg-[#5B4BC4] disabled:opacity-40">Alocar</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button onClick={() => document.getElementById("checkouts-panel")?.scrollIntoView({ behavior: "smooth" })} className="flex w-full items-center justify-center gap-2 rounded-[22px] border-2 border-dashed border-[#C9BFFF] bg-white/40 p-4 text-sm font-bold text-[#4B3DA8] hover:bg-white/70">
          <Plus className="h-4 w-4" /> Novo caixa
        </button>
      </aside>
      </div>
    </div>
  );
};
