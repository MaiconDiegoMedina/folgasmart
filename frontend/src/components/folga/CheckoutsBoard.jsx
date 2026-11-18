import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DAYS, weekDates, isoDate, http, errMsg } from "@/lib/api";
import { peakHours } from "@/lib/hourlyReport";
import { defaultShiftOf, toMin, dayMinutes } from "@/lib/workloadTimes";
import { isIntermittent, acceptedOn } from "@/lib/convocation";
import { WeekNav } from "@/components/folga/WeekNav";
import { PageTitle } from "@/components/folga/Header";
import { CheckoutsPanel } from "@/components/folga/CheckoutsPanel";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const ALL_HOURS = Array.from({ length: 18 }, (_, i) => 6 + i); // 6h..23h
const TURNOS = [
  { id: "dia", name: "Dia todo", a: 6, b: 24 },
  { id: "manha", name: "Manhã", a: 6, b: 12 },
  { id: "tarde", name: "Tarde", a: 12, b: 18 },
  { id: "noite", name: "Noite", a: 18, b: 24 },
];
const fmtDur = (m) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
const SHORT_DAY = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

const LVL = {
  ok: { bar: "#BFE6D1", barInk: "#1D6B45", tile: { background: "#E3F5EC", borderColor: "#8FD0AE" }, ink: "#1D6B45", avatar: { background: "#BFE6D1", color: "#1D6B45" } },
  warn: { bar: "#F7DC8A", barInk: "#5C4000", tile: { background: "#FFF4D1", borderColor: "#F2CF6B" }, ink: "#7A5500", avatar: { background: "#F7DC8A", color: "#5C4000" } },
  risk: { bar: "#F4B4B4", barInk: "#8A1F1F", tile: { background: "#FDE2E2", borderColor: "#EE9A9A" }, ink: "#A12828", avatar: { background: "#F4B4B4", color: "#8A1F1F" } },
};
const TONE = {
  ok: { background: "#E3F5EC", color: "#1D6B45" },
  warn: { background: "#FFF4D1", color: "#7A5500" },
  risk: { background: "#FDE2E2", color: "#A12828" },
  none: { background: "#F2F0F8", color: "#4A4566" },
};
const BAR_BG = { ok: "#8FD0AE", warn: "#F2C94C", risk: "#EE9A9A" };
const initials = (n) => n.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const CHIP = "inline-flex h-[26px] items-center whitespace-nowrap rounded-[13px] px-2.5 text-xs font-semibold";
const PILL = "h-[38px] rounded-[19px] border px-4 text-sm font-medium";
const pillStyle = (on) => (on ? "border-[#17142E] bg-[#17142E] text-white" : "border-[#E4E0F3] bg-white/75 text-[#3A3555] hover:border-[#17142E]");

// Frente de caixa: posição de cada operadora por caixa ao longo do dia
export const CheckoutsBoard = ({ employees, schedule, week, onWeek, workloads, sectorModes = {}, checkouts, onChange }) => {
  const dates = weekDates(week);
  const todayIdx = dates.findIndex((d) => isoDate(d) === isoDate(new Date()));
  const [day, setDay] = useState(todayIdx >= 0 ? todayIdx : 0);
  const [turno, setTurno] = useState("dia");
  const [assign, setAssign] = useState({});
  const [shifts, setShifts] = useState({});
  const [hourly, setHourly] = useState([]);
  const [picking, setPicking] = useState(null);
  const [moving, setMoving] = useState(null);
  const [filling, setFilling] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const [manage, setManage] = useState(false);

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
    setMoving(null);
    setFilling(null);
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
    const cover = ALL_HOURS.map((h) => {
      const t = h * 60 + 30;
      return rows.filter((r) => r.ops.some((o) => o.a !== null && o.a <= t && o.b > t)).length;
    });
    return { rows, loose, cover };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assign, shifts, day, employees, checkouts, schedule, workloads, sectorModes]);

  // Janela do gráfico conforme o turno escolhido
  const win = TURNOS.find((t) => t.id === turno);
  const START = win.a * 60;
  const END = win.b * 60;
  const SPAN = END - START;
  const HOURS = ALL_HOURS.filter((h) => h >= win.a && h < win.b);
  const pct = (m) => `${(((m - START) / SPAN) * 100).toFixed(2)}%`;
  const width = (a, b) => `${(((b - a) / SPAN) * 100).toFixed(2)}%`;
  const visible = (o) => o.a !== null && o.b > START && o.a < END;

  const nowMin = todayIdx === day ? new Date().getHours() * 60 + new Date().getMinutes() : null;
  const maxCover = Math.max(1, checkouts.length);

  // Meta por hora estimada pelo movimento: a hora mais cheia do dia pede todos os caixas
  const dayHours = hourly.find((h) => h.day === day)?.hours || [];
  const peakMax = Math.max(0, ...dayHours.map((h) => h.clients || 0));
  const need = ALL_HOURS.map((h) => {
    const c = dayHours.find((x) => x.hour === h)?.clients || 0;
    return peakMax && c && checkouts.length ? Math.max(1, Math.ceil((c / peakMax) * checkouts.length)) : null;
  });
  const hasNeed = need.some((n) => n !== null);
  const lvlOf = (n, t) => (t === null ? null : n >= t ? "ok" : n >= t * 0.75 ? "warn" : "risk");
  const idxOf = (h) => ALL_HOURS.indexOf(h);

  const peaks = peakHours(dayHours).filter((h) => ALL_HOURS.includes(h)).sort((a, b) => a - b);
  const peakLabel = peaks.length ? `${peaks[0]}h–${peaks[peaks.length - 1] + 1}h` : "";
  // Junta um conjunto de horas em "X de Y": menor número aberto contra a maior meta
  const rangeStat = (hrs) => {
    const idx = hrs.map(idxOf).filter((i) => i >= 0 && need[i] !== null);
    if (!idx.length) return null;
    const open = Math.min(...idx.map((i) => cover[i]));
    const req = Math.max(...idx.map((i) => need[i]));
    return { open, req, lvl: lvlOf(open, req) };
  };
  const peak = peaks.length ? rangeStat(peaks) : null;
  const coverage = [
    ...TURNOS.slice(1).map((t) => ({ name: t.name, st: rangeStat(ALL_HOURS.filter((h) => h >= t.a && h < t.b)) })),
    ...(peak ? [{ name: `Pico ${peakLabel}`, st: peak }] : []),
  ];
  const LABEL = { ok: "Ok", warn: "Atenção", risk: "Risco" };

  const dragProps = (o) => ({
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData("text/plain", o.emp.id);
      e.dataTransfer.effectAllowed = "move";
      setDragId(o.emp.id);
    },
    onDragEnd: () => {
      setDragId(null);
      setOver(null);
    },
  });
  const dropProps = (target) => ({
    onDragOver: (e) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (over !== target) setOver(target);
    },
    onDragLeave: () => setOver((v) => (v === target ? null : v)),
    onDrop: (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain") || dragId;
      setDragId(null);
      setOver(null);
      if (id) allocate(id, target === "none" ? null : target);
    },
  });
  const isSelf = (c) => /self/i.test(c.name);

  // Linha "Sem caixa": cada pessoa numa faixa para as barras não ficarem umas sobre as outras
  const lanes = [];
  loose.filter(visible).sort((x, y) => x.a - y.a).forEach((o) => {
    const lane = lanes.find((l) => l[l.length - 1].b <= o.a);
    if (lane) lane.push(o);
    else lanes.push([o]);
  });

  const Bar = ({ o, where }) =>
    !visible(o) ? null : (
      <>
        <div
          title={`${o.emp.name} · ${where} · ${o.shift[0]} às ${o.shift[o.shift.length - 1]}${o.brk ? ` · intervalo ${o.shift[1]}–${o.shift[2]}` : ""} · ${o.note}`}
          className={`absolute top-[3px] bottom-[3px] flex cursor-pointer items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[10px] px-2 text-xs font-semibold ${where === "sem caixa" ? "border-[1.5px] border-dashed border-[#B9B2DA] bg-white/60 text-[#4B3DA8]" : ""}`}
          style={{
            left: pct(Math.max(o.a, START)),
            width: `calc(${width(Math.max(o.a, START), Math.min(o.b, END))} - 2px)`,
            ...(where === "sem caixa" ? {} : { background: LVL[o.lvl].bar, color: LVL[o.lvl].barInk }),
          }}
        >
          {o.emp.name.split(" ")[0]}
          {Math.min(o.b, END) - Math.max(o.a, START) >= SPAN / 4 && <i className="text-[11px] font-medium not-italic opacity-80">{o.shift[0]} – {o.shift[o.shift.length - 1]}</i>}
        </div>
        {o.brk && o.brk[1] > START && o.brk[0] < END && (
          <div
            title={`Intervalo de ${o.emp.name.split(" ")[0]} · ${o.shift[1]}–${o.shift[2]}`}
            className="absolute top-[3px] bottom-[3px]"
            style={{ left: pct(Math.max(o.brk[0], START)), width: width(Math.max(o.brk[0], START), Math.min(o.brk[1], END)), background: "repeating-linear-gradient(135deg,rgba(255,255,255,.9) 0 3px,rgba(255,255,255,.35) 3px 6px)" }}
          />
        )}
      </>
    );

  const trackStyle = { background: `repeating-linear-gradient(90deg,rgba(94,88,128,.10) 0 1px,transparent 1px calc(100% / ${HOURS.length})),rgba(255,255,255,.55)` };
  const dayName = DAYS[day].toLowerCase();
  const dm = `${String(dates[day].getDate()).padStart(2, "0")}/${String(dates[day].getMonth() + 1).padStart(2, "0")}`;

  return (
    <section className="flex flex-col gap-5">
      <PageTitle
        eyebrow={`Frente de Caixa · ${dayName} ${dm}`}
        actions={
          <>
            {onWeek && <WeekNav week={week} onChange={onWeek} />}
            <button onClick={() => setManage(true)} className="inline-flex h-11 items-center gap-2 rounded-[22px] bg-[#6D5BD0] px-[18px] text-sm font-semibold text-white hover:bg-[#5B4BC4]">
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              Novo caixa
            </button>
          </>
        }
      >
        Quem fica em <em>cada caixa</em>
      </PageTitle>

      <div className="flex flex-wrap justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Dia">
          {SHORT_DAY.map((d, i) => (
            <button key={d} onClick={() => setDay(i)} aria-pressed={day === i} className={`${PILL} ${pillStyle(day === i)}`}>
              {d} {dates[i].getDate()}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Turno">
          {TURNOS.map((t) => (
            <button key={t.id} onClick={() => setTurno(t.id)} aria-pressed={turno === t.id} className={`${PILL} ${pillStyle(turno === t.id)}`}>{t.name}</button>
          ))}
        </div>
      </div>

      <section className="glass rounded-[26px] p-[22px]" aria-label="Posição dos caixas ao longo do dia">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="m-0 text-lg font-bold">Posição dos caixas no dia</h2>
            <p className="mt-1 text-[13px] text-[#5E5880]">Cada barra é uma operadora no seu caixa. Parte listrada = intervalo. Passe o mouse para ver o horário.</p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-[#4A4566]">
            <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-[#BFE6D1]" />Na jornada</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-[#F7DC8A]" />Extra no dia de folga</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-[#F4B4B4]" />+6 dias seguidos</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded border-[1.5px] border-dashed border-[#B9B2DA]" />Sem caixa</span>
            <span className="inline-flex items-center gap-1.5"><i className="h-3.5 w-0.5 bg-[#6D5BD0]" />Agora</span>
          </div>
        </div>
        {checkouts.length === 0 ? (
          <p className="py-6 text-sm text-[#5E5880]">Nenhum caixa cadastrado. Clique em "Novo caixa" para cadastrar.</p>
        ) : (
          <div className="-mx-1.5 overflow-x-auto px-1.5 pb-1 pt-2.5">
            <div className="flex min-w-[820px] flex-col gap-1.5">
              <div className="grid grid-cols-[96px_1fr] items-center gap-2.5">
                <span />
                <div className="grid font-display text-[11px] font-medium text-[#5E5880]" style={{ gridTemplateColumns: `repeat(${HOURS.length}, 1fr)` }}>
                  {HOURS.map((h) => <span key={h}>{String(h).padStart(2, "0")}h</span>)}
                </div>
              </div>
              {rows.map((r) => (
                <div key={r.id} className="grid grid-cols-[96px_1fr] items-center gap-2.5">
                  <div className="truncate font-display text-[13px] font-semibold">
                    {r.name}
                    <small className="block font-sans text-[11px] font-medium text-[#5E5880]">{r.ops.length ? `${r.ops.length} ${r.ops.length > 1 ? "turnos" : "turno"}` : "livre"}</small>
                  </div>
                  <div className="relative h-[34px] rounded-xl" style={trackStyle}>
                    {nowMin !== null && nowMin > START && nowMin < END && <div className="absolute -top-1.5 -bottom-1.5 z-[2] w-0.5 rounded bg-[#6D5BD0]" style={{ left: pct(nowMin) }} />}
                    {r.ops.map((o) => <Bar key={o.emp.id} o={o} where={r.name} />)}
                  </div>
                </div>
              ))}
              {loose.length > 0 && (
                <div className="grid grid-cols-[96px_1fr] items-center gap-2.5">
                  <div className="font-display text-[13px] font-semibold">Sem caixa<small className="block font-sans text-[11px] font-medium text-[#5E5880]">{loose.length} {loose.length === 1 ? "pessoa" : "pessoas"}</small></div>
                  <div className="flex flex-col gap-1">
                    {(lanes.length ? lanes : [[]]).map((l, i) => (
                      <div key={i} className="relative h-[34px] rounded-xl border border-dashed border-[#D6D0EE]">{l.map((o) => <Bar key={o.emp.id} o={o} where="sem caixa" />)}</div>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-[18px] grid grid-cols-[96px_1fr] items-end gap-2.5">
                <div className="font-display text-[13px] font-semibold">Abertos<small className="block font-sans text-[11px] font-medium text-[#5E5880]">{hasNeed ? "por hora / meta" : "por hora"}</small></div>
                <div className="grid h-16 items-end gap-1" style={{ gridTemplateColumns: `repeat(${HOURS.length}, 1fr)` }}>
                  {HOURS.map((h) => {
                    const i = idxOf(h);
                    const n = cover[i];
                    const l = lvlOf(n, need[i]);
                    return (
                      <div
                        key={h}
                        title={`${String(h).padStart(2, "0")}h: ${n} ${n === 1 ? "caixa aberto" : "caixas abertos"}${need[i] !== null ? ` · meta ${need[i]}` : ""}`}
                        className="relative flex justify-center rounded-t-md rounded-b-[3px]"
                        style={{ height: `${Math.max(6, (n / maxCover) * 100)}%`, background: l ? BAR_BG[l] : "#C9BFFF" }}
                      >
                        <b className="absolute -top-4 whitespace-nowrap font-display text-[11px] font-semibold" style={{ color: l ? LVL[l].ink : "#4B3DA8" }}>{need[i] !== null ? `${n}/${need[i]}` : n}</b>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-start gap-5">
        <section className="grid min-w-0 gap-4" style={{ flex: "3 1 600px", gridTemplateColumns: "repeat(auto-fill, minmax(min(330px, 100%), 1fr))" }}>
          {rows.map((r) => {
            const dark = isSelf(r);
            return (
              <div
                key={r.id}
                {...dropProps(r.id)}
                className={`flex flex-col gap-3.5 rounded-[22px] border p-[18px] shadow-[0_10px_30px_-20px_rgba(70,50,160,0.25)] transition ${dark ? "border-[#17142E] bg-[#17142E] text-white" : "border-white bg-white/80"} ${over === r.id ? "ring-2 ring-[#6D5BD0] ring-offset-2" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="m-0 font-display text-lg font-semibold">{r.name}</h3>
                  <span className={CHIP} style={dark ? { background: "#3A3463", color: "#E9E6F8" } : r.ops.length >= 2 ? TONE.ok : r.ops.length === 1 ? TONE.warn : TONE.none}>
                    {r.ops.length >= 2 ? `Aberto · ${r.ops.length} turnos` : r.ops.length === 1 ? "Aberto · 1 turno" : "Livre"}
                  </span>
                </div>
                <div className="grid grid-cols-2 items-start gap-2.5">
                  {r.ops.map((o) => (
                    <div
                      key={o.emp.id}
                      {...dragProps(o)}
                      title={`${o.emp.name} · ${o.shift ? `${o.shift[0]} às ${o.shift[o.shift.length - 1]}` : "sem horário"} · ${o.note}. Arraste para outro caixa.`}
                      className={`group relative flex cursor-grab items-start gap-2.5 rounded-[14px] border-[1.5px] p-2 pr-6 text-[13px] font-semibold text-[#1B1830] active:cursor-grabbing ${dragId === o.emp.id ? "opacity-40" : ""}`}
                      style={LVL[o.lvl].tile}
                    >
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold" style={LVL[o.lvl].avatar}>{initials(o.emp.name)}</div>
                      <div className="min-w-0">
                        <span className="block truncate">{o.emp.name}</span>
                        <small className="block text-xs font-medium text-[#5E5880]">{o.daily}</small>
                        <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.04em] text-[#8A85A3]">{o.contract}</span>
                        {moving === o.emp.id ? (
                          <select
                            autoFocus
                            aria-label={`Trocar o caixa de ${o.emp.name}`}
                            defaultValue={r.id}
                            onBlur={() => setMoving(null)}
                            onChange={(e) => e.target.value !== r.id && allocate(o.emp.id, e.target.value)}
                            className="mt-1 h-7 w-full rounded-lg border border-[#E4E0F3] bg-white px-1 text-[11px]"
                          >
                            {checkouts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        ) : (
                          <span className="mt-1 flex items-center gap-2">
                            <span className="text-[11px] font-bold" style={{ color: LVL[o.lvl].ink }}>{o.lvl === "ok" ? "Na jornada" : o.lvl === "warn" ? "Extra" : "+6 dias"}</span>
                            <button onClick={() => setMoving(o.emp.id)} className="text-[11px] font-semibold text-[#5B4BC4] hover:underline">Trocar</button>
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => allocate(o.emp.id, null)}
                        aria-label={`Tirar ${o.emp.name} do ${r.name}`}
                        title="Tirar do caixa"
                        className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full text-[#8A85A3] hover:bg-white hover:text-[#A12828]"
                      >
                        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                      </button>
                    </div>
                  ))}
                  {r.ops.length < 2 && (
                    filling === r.id ? (
                      <select
                        autoFocus
                        aria-label={`Escolher operadora para ${r.name}`}
                        defaultValue=""
                        onBlur={() => setFilling(null)}
                        onChange={(e) => e.target.value && allocate(e.target.value, r.id)}
                        className={`h-[46px] rounded-[14px] border-[1.5px] border-[#6D5BD0] bg-white px-2 text-[13px] text-[#1B1830] ${r.ops.length === 0 ? "col-span-2" : ""}`}
                      >
                        <option value="" disabled>Quem fica neste caixa?</option>
                        {loose.map((o) => <option key={o.emp.id} value={o.emp.id}>{o.emp.name}{o.shift ? ` · ${o.shift[0]}–${o.shift[o.shift.length - 1]}` : ""}</option>)}
                      </select>
                    ) : (
                      <button
                        disabled={!loose.length}
                        onClick={() => setFilling(r.id)}
                        title={loose.length ? "Escolher quem fica neste caixa" : "Todo mundo do caixa já está alocado. Arraste de outro caixa para trocar."}
                        className={`flex min-h-[46px] items-center justify-center gap-1.5 self-stretch rounded-[14px] border-[1.5px] border-dashed px-2 text-center text-[13px] font-semibold disabled:cursor-default ${dark ? "border-[#3A3463] text-[#C9C4E6]" : "border-[#D6D0EE] text-[#4B3DA8] enabled:hover:bg-[#F3F1FA]"} ${r.ops.length === 0 ? "col-span-2" : ""}`}
                      >
                        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                        {loose.length ? "Escolher operadora" : r.ops.length === 0 ? "Caixa livre" : "Segundo turno livre"}
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </section>

        <aside className="flex min-w-0 flex-col gap-4" style={{ flex: "1 1 300px" }}>
          {peak && (
            <div className="rounded-[26px] border p-[22px]" style={{ background: TONE[peak.lvl].background, borderColor: peak.lvl === "ok" ? "#8FD0AE" : peak.lvl === "warn" ? "#F2CF6B" : "#EE9A9A", color: TONE[peak.lvl].color }}>
              <p className="m-0 text-[13px] font-semibold">Caixas no horário de pico ({peakLabel})</p>
              <p className="mt-2 font-display text-[40px] font-semibold leading-none tracking-[-1px]">
                {peak.open} <span className="font-sans text-lg font-medium">de {peak.req} necessários</span>
              </p>
              <div className="mt-3.5 flex h-2 gap-1">
                {peak.open > 0 && <div className="rounded" style={{ flex: Math.min(peak.open, peak.req), background: peak.lvl === "ok" ? "#3E9B6B" : peak.lvl === "warn" ? "#E0B13A" : "#D9534F" }} />}
                {peak.req > peak.open && <div className="rounded bg-white" style={{ flex: peak.req - peak.open }} />}
              </div>
              <p className="mt-3 text-[13px]">
                {peak.open >= peak.req ? <><strong>Ok:</strong> o pico está coberto.</> : <><strong>{LABEL[peak.lvl]}:</strong> {peak.req - peak.open === 1 ? "falta 1 operadora" : `faltam ${peak.req - peak.open} operadoras`} no pico. Convoque intermitentes.</>}
              </p>
            </div>
          )}
          <div className="glass flex flex-col gap-2.5 rounded-[26px] p-[22px]">
            <p className="m-0 text-[13px] font-semibold text-[#5E5880]">Cobertura do dia por turno</p>
            {!hasNeed ? (
              <p className="m-0 text-[13px] text-[#5E5880]">Importe o movimento por hora deste dia na sub-aba de horários da Escala para ver quantos caixas precisam estar abertos.</p>
            ) : (
              coverage.map(({ name, st }) => (
                <div key={name} className="flex items-center justify-between">
                  <span className="text-sm">{name}</span>
                  {st ? <span className={CHIP} style={TONE[st.lvl]}>{LABEL[st.lvl]} · {st.open} de {st.req}</span> : <span className="text-xs text-[#8A85A3]">sem movimento</span>}
                </div>
              ))
            )}
          </div>
          <div {...dropProps("none")} className={`glass rounded-[26px] p-[22px] transition ${over === "none" ? "ring-2 ring-[#6D5BD0]" : ""}`}>
            <h2 className="mb-1 text-base font-bold">Trabalhando sem caixa</h2>
            <p className="mb-3.5 text-xs text-[#5E5880]">Arraste para um caixa, ou solte aqui para tirar do caixa.</p>
            {loose.length === 0 ? (
              <p className="m-0 text-[13px] text-[#5E5880]">Todo mundo do caixa que trabalha neste dia já tem um caixa.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {loose.map((o) => (
                  <div key={o.emp.id} {...dragProps(o)} className={`flex cursor-grab items-center gap-2.5 text-sm font-semibold active:cursor-grabbing ${dragId === o.emp.id ? "opacity-40" : ""}`}>
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#E6E1FA] text-xs font-bold text-[#4B3DA8]">{initials(o.emp.name)}</div>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate">{o.emp.name}</span>
                      <small className="block text-xs font-medium text-[#5E5880]">{o.shift ? `entra ${o.shift[0]}` : "sem horário"}</small>
                    </div>
                    {picking === o.emp.id ? (
                      <select autoFocus aria-label={`Caixa de ${o.emp.name}`} defaultValue="" onBlur={() => setPicking(null)} onChange={(e) => e.target.value && allocate(o.emp.id, e.target.value)} className="h-[34px] rounded-[17px] border border-[#E4E0F3] bg-white px-2 text-xs">
                        <option value="" disabled>Caixa…</option>
                        {checkouts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    ) : (
                      <button disabled={!checkouts.length} onClick={() => setPicking(o.emp.id)} className="h-[34px] rounded-[17px] border border-[#E4E0F3] bg-white/80 px-3 text-xs font-semibold text-[#1B1830] hover:border-[#17142E] disabled:opacity-40">Alocar</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      <Dialog open={manage} onOpenChange={setManage}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Caixas da loja</DialogTitle>
            <DialogDescription>Cadastre ou exclua os caixas da frente de caixa.</DialogDescription>
          </DialogHeader>
          <CheckoutsPanel checkouts={checkouts} onChange={onChange} bare />
        </DialogContent>
      </Dialog>
    </section>
  );
};
