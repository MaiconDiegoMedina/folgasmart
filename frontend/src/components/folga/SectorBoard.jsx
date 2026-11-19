import { useEffect, useMemo, useState } from "react";
import { Beef, Croissant, Apple, PackageOpen, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { DAYS, weekDates, isoDate, http, errMsg } from "@/lib/api";
import { peakHours } from "@/lib/hourlyReport";
import { defaultShiftOf, toMin, dayMinutes } from "@/lib/workloadTimes";
import { isIntermittent, acceptedOn } from "@/lib/convocation";
import { WeekNav } from "@/components/folga/WeekNav";
import { PageTitle } from "@/components/folga/Header";
import { ShiftBar, dayLabel, dayStatus } from "@/components/folga/ShiftBar";
import { useShiftDrag, shiftPayload } from "@/lib/useShiftDrag";

// Abas de setor: o setor do funcionário é reconhecido pelo nome (ex.: "Açougue", "Hortifruti", "FLV")
export const SECTOR_TABS = [
  { id: "acougue", label: "Açougue", match: /a[çc]oug/i, icon: Beef, hint: "Açougue", title: ["no", "açougue"] },
  { id: "padaria", label: "Padaria", match: /padaria|panifica|confeita/i, icon: Croissant, hint: "Padaria", title: ["na", "padaria"] },
  { id: "flv", label: "Hortifruti (FLV)", short: "FLV", match: /horti|flv|frut|verdur|legum/i, icon: Apple, hint: "Hortifruti", title: ["no", "hortifrúti"] },
  { id: "reposicao", label: "Reposição", match: /reposi|repositor|estoque/i, icon: PackageOpen, hint: "Reposição", title: ["na", "reposição"] },
];

const ALL_HOURS = Array.from({ length: 18 }, (_, i) => 6 + i); // 6h..23h
const TURNOS = [
  { id: "dia", name: "Dia todo", a: 6, b: 24 },
  { id: "manha", name: "Manhã", a: 6, b: 12 },
  { id: "tarde", name: "Tarde", a: 12, b: 18 },
  { id: "noite", name: "Noite", a: 18, b: 24 },
];
const SHORT_DAY = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const fmtDur = (m) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
const initials = (n) => n.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const LVL = {
  ok: { bar: "#BFE6D1", barInk: "#1D6B45", tile: { background: "#E3F5EC", borderColor: "#8FD0AE" }, ink: "#1D6B45", avatar: { background: "#BFE6D1", color: "#1D6B45" } },
  warn: { bar: "#F7DC8A", barInk: "#5C4000", tile: { background: "#FFF4D1", borderColor: "#F2CF6B" }, ink: "#7A5500", avatar: { background: "#F7DC8A", color: "#5C4000" } },
  risk: { bar: "#F4B4B4", barInk: "#8A1F1F", tile: { background: "#FDE2E2", borderColor: "#EE9A9A" }, ink: "#A12828", avatar: { background: "#F4B4B4", color: "#8A1F1F" } },
  help: { bar: "#DCD5FA", barInk: "#4B3DA8", tile: { background: "#F3F1FA", borderColor: "#C9BFFF" }, ink: "#4B3DA8", avatar: { background: "#DCD5FA", color: "#4B3DA8" } },
};
const TONE = {
  ok: { background: "#E3F5EC", color: "#1D6B45" },
  warn: { background: "#FFF4D1", color: "#7A5500" },
  risk: { background: "#FDE2E2", color: "#A12828" },
  none: { background: "#F2F0F8", color: "#4A4566" },
};
const CHIP = "inline-flex h-[26px] items-center whitespace-nowrap rounded-[13px] px-2.5 text-xs font-semibold";
const PILL = "h-[38px] rounded-[19px] border px-4 text-sm font-medium";
const pillStyle = (on) => (on ? "border-[#17142E] bg-[#17142E] text-white" : "border-[#E4E0F3] bg-white/75 text-[#3A3555] hover:border-[#17142E]");

// Equipe de um setor no dia: horários, presença por hora, cobertura por turno e quem está fora
export const SectorBoard = ({ tab, employees, schedule, week, onWeek, workloads, sectorModes = {} }) => {
  const conf = SECTOR_TABS.find((t) => t.id === tab) || SECTOR_TABS[0];
  const dates = weekDates(week);
  const todayIdx = dates.findIndex((d) => isoDate(d) === isoDate(new Date()));
  const [day, setDay] = useState(todayIdx >= 0 ? todayIdx : 0);
  const [turno, setTurno] = useState("dia");
  const [shifts, setShifts] = useState({});
  const [hourly, setHourly] = useState([]);

  const [helpId, setHelpId] = useState("");
  const [helpFrom, setHelpFrom] = useState("");
  const [helpTo, setHelpTo] = useState("");
  const [saving, setSaving] = useState(false);
  const loadShifts = () => http.get("/shifts/week", { params: { week } }).then(({ data }) => setShifts(data)).catch(() => setShifts({}));

  useEffect(() => {
    loadShifts();
    http.get("/hourly", { params: { week } }).then(({ data }) => setHourly(data || [])).catch(() => setHourly([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  const members = employees.filter((e) => conf.match.test(e.sector || ""));
  const sectorNames = [...new Set(members.map((e) => e.sector))];
  const has = (key, id, d) => (schedule[key]?.[id] || []).includes(d);
  const closed = (schedule.closed_days || []).includes(day);
  const modeOf = (sector) => {
    const used = Object.entries(schedule.sector_modes || {}).find(([k]) => k.toLowerCase() === (sector || "").toLowerCase());
    return used?.[1] || sectorModes[(sector || "").toLowerCase()] || "6x1";
  };
  // Por que a pessoa não trabalha no dia (null = trabalha)
  const awayOf = (e, d) => {
    if ((schedule.closed_days || []).includes(d)) return "Loja fechada";
    if (has("vacation_days", e.id, d)) return "Férias";
    if (has("sick_days", e.id, d)) return "Atestado";
    if (has("suspension_days", e.id, d)) return "Suspensão";
    if (has("absence_days", e.id, d)) return "Falta";
    if (isIntermittent(e)) return acceptedOn(schedule, e.id, d) ? null : "Sem convocação";
    if (has("off_days", e.id, d) && !has("extra_days", e.id, d)) return "Folga";
    return null;
  };
  const shiftOf = (e, d) =>
    shifts[String(d)]?.[e.id] || (isIntermittent(e) ? null : defaultShiftOf(workloads.find((w) => w.id === e.workload), modeOf(e.sector), d));

  const { team, away, cover } = useMemo(() => {
    const person = (e, s, lvl, note, key = e.id, base = null) => ({
      emp: e, shift: s, lvl, note, key, base,
      label: dayLabel(s, base),
      a: s ? toMin(s[0]) : null,
      b: s ? toMin(s[s.length - 1]) : null,
      brk: s && s.length === 4 ? [toMin(s[1]), toMin(s[2])] : null,
      daily: s ? `${fmtDur(dayMinutes(s))} no dia` : "sem horário",
    });
    const team = [];
    const away = [];
    for (const e of members) {
      const why = awayOf(e, day);
      if (why) {
        away.push({ emp: e, why });
        continue;
      }
      const streak = (schedule.streak_alerts?.[e.id] || []).includes(day);
      const extra = has("extra_days", e.id, day);
      const base = isIntermittent(e) ? null : dayMinutes(defaultShiftOf(workloads.find((w) => w.id === e.workload), modeOf(e.sector), day)) || null;
      const s = shiftOf(e, day);
      const st = dayStatus({ shift: s, base, streak, offDay: extra });
      team.push(person(e, s, st.lvl, st.note, e.id, base));
    }
    // Ajuda de outro setor salva na sub-aba de horários (chave "funcionário@setor")
    const byId = Object.fromEntries(employees.map((e) => [e.id, e]));
    for (const [key, s] of Object.entries(shifts[String(day)] || {})) {
      const parts = key.split("@");
      if (parts.length !== 2 || !sectorNames.some((n) => n.toLowerCase() === parts[1].toLowerCase())) continue;
      const e = byId[parts[0]];
      if (e && !conf.match.test(e.sector || "")) team.push(person(e, s, "help", `Ajuda vinda de ${e.sector}`, key));
    }
    team.sort((x, y) => (x.a ?? 9999) - (y.a ?? 9999) || x.emp.name.localeCompare(y.emp.name, "pt-BR"));
    away.sort((x, y) => x.why.localeCompare(y.why) || x.emp.name.localeCompare(y.emp.name, "pt-BR"));
    const presentAt = (o, t) => o.a !== null && o.a <= t && o.b > t && !(o.brk && o.brk[0] <= t && o.brk[1] > t);
    const cover = ALL_HOURS.map((h) => team.filter((o) => presentAt(o, h * 60 + 30)).length);
    return { team, away, cover };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, schedule, shifts, day, tab, workloads, sectorModes]);

  const win = TURNOS.find((t) => t.id === turno);
  const START = win.a * 60;
  const END = win.b * 60;
  const SPAN = END - START;
  const HOURS = ALL_HOURS.filter((h) => h >= win.a && h < win.b);
  const pct = (m) => `${(((m - START) / SPAN) * 100).toFixed(2)}%`;
  const width = (a, b) => `${(((b - a) / SPAN) * 100).toFixed(2)}%`;
  const visible = (o) => o.a !== null && o.b > START && o.a < END;

  // Arrastar a barra muda o horário do dia (o mesmo ajuste da sub-aba de horários)
  const saveShift = async (o, s) => {
    if (!s) return;
    const k = String(day);
    const put = (times) => http.put("/shifts", { week, day, employee_id: o.key, ...(times ? shiftPayload(times) : {}) });
    setShifts((prev) => ({ ...prev, [k]: { ...(prev[k] || {}), [o.key]: s } }));
    try {
      await put(s);
      const extra = o.base ? dayMinutes(s) - o.base : 0;
      toast.success(
        `${o.emp.name.split(" ")[0]}: ${s[0]} às ${s[s.length - 1]}${extra > 0 ? ` · ${fmtDur(extra)} de hora extra` : extra < 0 ? ` · ${fmtDur(-extra)} a menos que a jornada` : ""}`
      );
    } catch (e) {
      toast.error(errMsg(e));
    }
    loadShifts();
  };
  const { grab, preview, shiftFor } = useShiftDrag({ span: SPAN, onCommit: saveShift });
  const nowMin = todayIdx === day ? new Date().getHours() * 60 + new Date().getMinutes() : null;
  const idxOf = (h) => ALL_HOURS.indexOf(h);
  const maxCover = Math.max(1, ...cover);

  const dayHours = hourly.find((h) => h.day === day)?.hours || [];
  const peaks = peakHours(dayHours).filter((h) => ALL_HOURS.includes(h)).sort((a, b) => a - b);
  const peakLabel = peaks.length ? `${peaks[0]}h–${peaks[peaks.length - 1] + 1}h` : "";
  // Horas em que a loja tem gente do setor ou movimento: fora disso não conta como "descoberto"
  const openHours = ALL_HOURS.filter((h) => cover[idxOf(h)] > 0 || dayHours.some((x) => x.hour === h && x.clients > 0));
  const rangeStat = (hrs) => {
    const idx = hrs.filter((h) => openHours.includes(h)).map(idxOf);
    if (!idx.length) return null;
    const min = Math.min(...idx.map((i) => cover[i]));
    return { min, lvl: min >= 2 ? "ok" : min === 1 ? "warn" : "risk" };
  };
  const coverage = [
    ...TURNOS.slice(1).map((t) => ({ name: t.name, st: rangeStat(ALL_HOURS.filter((h) => h >= t.a && h < t.b)) })),
    ...(peaks.length ? [{ name: `Pico ${peakLabel}`, st: rangeStat(peaks) }] : []),
  ];
  const LABEL = { ok: "Ok", warn: "Atenção", risk: "Descoberto" };

  // Ajuda de outro setor (a mesma da sub-aba de horários): turno salvo como "funcionário@setor"
  const counts = members.reduce((m, e) => ({ ...m, [e.sector]: (m[e.sector] || 0) + 1 }), {});
  const sectorName = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || conf.hint;
  const helpKeyOf = (id) => Object.keys(shifts[String(day)] || {}).find((k) => {
    const parts = k.split("@");
    return parts.length === 2 && parts[0] === id && sectorNames.some((n) => n.toLowerCase() === parts[1].toLowerCase());
  });
  const helpers = team.filter((o) => o.lvl === "help");
  const candidates = employees
    .filter((e) => !conf.match.test(e.sector || "") && !awayOf(e, day) && !helpKeyOf(e.id))
    .sort((a, b) => (a.sector || "").localeCompare(b.sector || "", "pt-BR") || a.name.localeCompare(b.name, "pt-BR"));
  const pad2 = (n) => String(n).padStart(2, "0");
  const defFrom = `${pad2(peaks.length ? peaks[0] : 11)}:00`;
  const defTo = `${pad2(Math.min(peaks.length ? peaks[peaks.length - 1] + 1 : 14, 23))}:00`;
  const callHelp = async () => {
    const start = helpFrom || defFrom;
    const end = helpTo || defTo;
    if (!helpId) return toast.error("Escolha quem vai ajudar.");
    if (!start || !end || end <= start) return toast.error("Informe de que horas até que horas a pessoa ajuda.");
    setSaving(true);
    try {
      await http.put("/shifts", { week, day, employee_id: `${helpId}@${sectorName}`, start, end });
      const e = employees.find((x) => x.id === helpId);
      toast.success(`${e?.name.split(" ")[0] || "Pessoa"} vai ajudar em ${conf.label} das ${start} às ${end}`);
      setHelpId("");
      setHelpFrom("");
      setHelpTo("");
      await loadShifts();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setSaving(false);
    }
  };
  const dropHelp = async (id) => {
    const key = helpKeyOf(id);
    if (!key) return;
    try {
      await http.put("/shifts", { week, day, employee_id: key });
      await loadShifts();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const alerts = team.filter((o) => o.lvl === "risk" || o.lvl === "warn" || !o.shift);
  const own = team.filter((o) => o.lvl !== "help");
  const dm = `${String(dates[day].getDate()).padStart(2, "0")}/${String(dates[day].getMonth() + 1).padStart(2, "0")}`;
  const trackStyle = { background: `repeating-linear-gradient(90deg,rgba(94,88,128,.10) 0 1px,transparent 1px calc(100% / ${HOURS.length})),rgba(255,255,255,.55)` };

  return (
    <section data-testid={`sector-board-${conf.id}`} className="flex flex-col gap-5">
      <PageTitle eyebrow={`${conf.label} · ${DAYS[day].toLowerCase()} ${dm}`} actions={<WeekNav week={week} onChange={onWeek} />}>
        Quem está {conf.title[0]} <em>{conf.title[1]}</em>
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

      {members.length === 0 ? (
        <div className="glass rounded-[26px] p-[22px] text-sm text-[#4A4566]">
          <h2 className="m-0 mb-1.5 text-lg font-bold text-[#1B1830]">Ninguém cadastrado em {conf.label}</h2>
          Na aba Funcionários, coloque o setor <strong>{conf.hint}</strong> em quem trabalha aqui. A aba reconhece o setor pelo nome
          {conf.id === "flv" ? " (Hortifruti, Hortifrúti, FLV ou Frutas)" : conf.id === "reposicao" ? " (Reposição, Repositor ou Estoque)" : conf.id === "padaria" ? " (Padaria, Panificação ou Confeitaria)" : ""}.
        </div>
      ) : (
        <>
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))" }}>
            <div className="glass rounded-[22px] p-[18px]">
              <p className="m-0 text-[13px] text-[#5E5880]">Trabalhando no dia</p>
              <p className="mt-1 font-display text-[30px] font-semibold leading-none">{own.length}<small className="font-sans text-sm font-medium text-[#5E5880]"> de {members.length}</small></p>
              {team.length > own.length && <p className="mt-1.5 text-xs font-semibold text-[#4B3DA8]">+{team.length - own.length} de outro setor ajudando</p>}
            </div>
            <div className="glass rounded-[22px] p-[18px]">
              <p className="m-0 text-[13px] text-[#5E5880]">Fora no dia</p>
              <p className="mt-1 font-display text-[30px] font-semibold leading-none">{away.length}</p>
              <p className="mt-1.5 truncate text-xs text-[#5E5880]">{closed ? "Loja fechada" : away.length ? away.map((x) => x.emp.name.split(" ")[0]).join(", ") : "Todo mundo trabalha"}</p>
            </div>
            <div className="glass rounded-[22px] p-[18px]">
              <p className="m-0 text-[13px] text-[#5E5880]">Precisa de atenção</p>
              <p className="mt-1 font-display text-[30px] font-semibold leading-none" style={{ color: alerts.length ? "#A12828" : "#1D6B45" }}>{alerts.length}</p>
              <p className="mt-1.5 text-xs text-[#5E5880]">{alerts.length ? "Veja os cartões em vermelho e amarelo" : "Nenhum alerta neste dia"}</p>
            </div>
          </div>

          <section className="glass rounded-[26px] p-[22px]" aria-label={`Equipe de ${conf.label} ao longo do dia`}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="m-0 text-lg font-bold">Posição da equipe no dia</h2>
                <p className="mt-1 text-[13px] text-[#5E5880]">Cada barra é uma pessoa. Parte listrada = intervalo. Arraste a barra para mudar o horário; puxe a ponta direita para hora extra. No celular, segure a barra antes de arrastar.</p>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-[#4A4566]">
                <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-[#BFE6D1]" />Na jornada</span>
                <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-[#F7DC8A]" />Hora extra</span>
                <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-[#F4B4B4]" />Fora da jornada (folga ou +6 dias)</span>
                <span className="inline-flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-[#DCD5FA]" />Ajuda de outro setor</span>
                <span className="inline-flex items-center gap-1.5"><i className="h-3.5 w-0.5 bg-[#6D5BD0]" />Agora</span>
              </div>
            </div>
            {team.length === 0 ? (
              <p className="py-6 text-sm text-[#5E5880]">{closed ? "Loja fechada neste dia." : `Ninguém de ${conf.label} trabalha neste dia.`}</p>
            ) : (
              <div className="-mx-1.5 overflow-x-auto px-1.5 pb-1 pt-2.5">
                <div className="flex min-w-[820px] flex-col gap-1.5">
                  <div className="grid grid-cols-[110px_1fr] items-center gap-2.5">
                    <span />
                    <div className="grid font-display text-[11px] font-medium text-[#5E5880]" style={{ gridTemplateColumns: `repeat(${HOURS.length}, 1fr)` }}>
                      {HOURS.map((h) => <span key={h} className={peaks.includes(h) ? "font-semibold text-[#7A5500]" : ""}>{String(h).padStart(2, "0")}h</span>)}
                    </div>
                  </div>
                  {team.map((o) => (
                    <div key={`${o.emp.id}${o.lvl}`} className="grid grid-cols-[110px_1fr] items-center gap-2.5">
                      <div className="truncate font-display text-[13px] font-semibold" title={o.emp.name}>
                        {o.emp.name.split(" ").slice(0, 2).join(" ")}
                        <small className="block truncate font-sans text-[11px] font-medium text-[#5E5880]">{o.lvl === "help" ? `ajuda · ${o.emp.sector}` : o.shift ? (o.a < 12 * 60 ? "1º turno" : "2º turno") : "sem horário"}</small>
                      </div>
                      <div data-track className="relative h-[34px] rounded-xl" style={trackStyle}>
                        {nowMin !== null && nowMin > START && nowMin < END && <div className="absolute -top-1.5 -bottom-1.5 z-[2] w-0.5 rounded bg-[#6D5BD0]" style={{ left: pct(nowMin) }} />}
                        <ShiftBar
                          o={o}
                          shift={shiftFor(o)}
                          win={{ START, END, SPAN }}
                          colors={{ bg: LVL[o.lvl].bar, ink: LVL[o.lvl].barInk }}
                          title={`${o.emp.name} · ${o.note}.`}
                          grab={grab}
                          drag={preview?.key === o.key ? preview : null}
                          extra={o.base && shiftFor(o) ? dayMinutes(shiftFor(o)) - o.base : 0}
                        />
                      </div>
                    </div>
                  ))}
                  <div className="mt-[18px] grid grid-cols-[110px_1fr] items-end gap-2.5">
                    <div className="font-display text-[13px] font-semibold">Escalados<small className="block font-sans text-[11px] font-medium text-[#5E5880]">por hora</small></div>
                    <div className="grid h-16 items-end gap-1" style={{ gridTemplateColumns: `repeat(${HOURS.length}, 1fr)` }}>
                      {HOURS.map((h) => {
                        const n = cover[idxOf(h)];
                        const pk = peaks.includes(h);
                        return (
                          <div
                            key={h}
                            title={`${String(h).padStart(2, "0")}h: ${n} ${n === 1 ? "pessoa escalada" : "pessoas escaladas"}${pk ? " · horário de pico" : ""}`}
                            className="relative flex justify-center rounded-t-md rounded-b-[3px]"
                            style={{ height: `${Math.max(6, (n / maxCover) * 100)}%`, background: pk ? (n ? "#F2C94C" : "#EE9A9A") : n ? "#C9BFFF" : "#ECE8FB" }}
                          >
                            <b className="absolute -top-4 font-display text-[11px] font-semibold text-[#4B3DA8]">{n}</b>
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
            <section className="grid min-w-0 gap-3" style={{ flex: "3 1 600px", gridTemplateColumns: "repeat(auto-fill, minmax(min(260px, 100%), 1fr))" }} aria-label="Pessoas trabalhando">
              {team.map((o) => (
                <div key={`${o.emp.id}${o.lvl}card`} title={o.note} className="flex items-start gap-2.5 rounded-[16px] border-[1.5px] p-3 text-[13px] font-semibold text-[#1B1830]" style={LVL[o.lvl].tile}>
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold" style={LVL[o.lvl].avatar}>{initials(o.emp.name)}</div>
                  <div className="min-w-0">
                    <span className="block truncate">{o.emp.name}</span>
                    <small className="block text-xs font-medium text-[#5E5880]">{o.shift ? `${o.shift[0]} às ${o.shift[o.shift.length - 1]} · ${o.label}` : "Sem horário definido"}</small>
                    {o.brk && <small className="block text-xs font-medium text-[#5E5880]">Intervalo {o.shift[1]}–{o.shift[2]}</small>}
                    <span className="mt-1 block text-[11px] font-bold" style={{ color: LVL[o.lvl].ink }}>{o.shift ? o.note : "Defina o horário na sub-aba de horários"}</span>
                  </div>
                </div>
              ))}
            </section>

            <aside className="flex min-w-0 flex-col gap-4" style={{ flex: "1 1 300px" }}>
              <div className="glass rounded-[26px] p-[22px]">
                <h2 className="mb-1 text-base font-bold">Cobertura por turno</h2>
                <p className="mb-3 text-xs text-[#5E5880]">Menor número de pessoas do setor ao mesmo tempo no turno.</p>
                <div className="flex flex-col gap-2.5">
                  {coverage.map(({ name, st }) => (
                    <div key={name} className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium">{name}</span>
                      <span className={CHIP} style={st ? TONE[st.lvl] : TONE.none}>{st ? `${LABEL[st.lvl]} · ${st.min} ${st.min === 1 ? "pessoa" : "pessoas"}` : "Fora do horário"}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="glass rounded-[26px] p-[22px]">
                <h2 className="mb-3 text-base font-bold">Fora neste dia</h2>
                {away.length === 0 ? (
                  <p className="m-0 text-[13px] text-[#5E5880]">Todo mundo do setor trabalha neste dia.</p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {away.map(({ emp, why }) => (
                      <div key={emp.id} className="flex items-center gap-2.5 text-sm font-semibold">
                        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#E6E1FA] text-[11px] font-bold text-[#4B3DA8]">{initials(emp.name)}</div>
                        <span className="min-w-0 flex-1 truncate">{emp.name}</span>
                        <span className={CHIP} style={why === "Folga" ? TONE.none : why === "Falta" || why === "Suspensão" ? TONE.risk : TONE.warn}>{why}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-4 border-t border-[#E4E0F3] pt-4">
                  <h3 className="m-0 flex items-center gap-1.5 text-sm font-bold text-[#4B3DA8]"><UserPlus className="h-4 w-4" /> Chamar alguém de outro setor</h3>
                  <p className="mb-3 mt-1 text-xs text-[#5E5880]">Quem trabalha neste dia em outro setor pode ajudar aqui por algumas horas. É a mesma ajuda da sub-aba de horários.</p>
                  {helpers.length > 0 && (
                    <div className="mb-3 flex flex-col gap-2">
                      {helpers.map((o) => (
                        <div key={o.emp.id} className="flex items-center gap-2.5 rounded-xl border border-[#C9BFFF] bg-[#F3F1FA] px-2.5 py-2 text-[13px] font-semibold">
                          <span className="min-w-0 flex-1 truncate">{o.emp.name}<small className="block text-[11px] font-medium text-[#5E5880]">vem de {o.emp.sector} · {o.shift[0]} às {o.shift[o.shift.length - 1]}</small></span>
                          <button onClick={() => dropHelp(o.emp.id)} aria-label={`Tirar ${o.emp.name} da ajuda`} title="Tirar da ajuda" className="grid h-7 w-7 place-items-center rounded-full text-[#8A85A3] hover:bg-white hover:text-[#A12828]">
                            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {closed ? (
                    <p className="m-0 text-xs text-[#5E5880]">Loja fechada neste dia.</p>
                  ) : candidates.length === 0 ? (
                    <p className="m-0 text-xs text-[#5E5880]">Ninguém de outro setor trabalha neste dia para chamar.</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <select aria-label="Quem vai ajudar" value={helpId} onChange={(e) => setHelpId(e.target.value)} className="h-10 rounded-xl border border-[#C9BFFF] bg-white px-2 text-sm text-[#1B1830]">
                        <option value="">Quem vai ajudar?</option>
                        {candidates.map((e) => {
                          const own = shiftOf(e, day);
                          return <option key={e.id} value={e.id}>{e.sector} · {e.name}{own ? ` (${own[0]}–${own[own.length - 1]})` : ""}</option>;
                        })}
                      </select>
                      <div className="flex items-center gap-2 text-xs text-[#5E5880]">
                        <span>das</span>
                        <input type="time" step={300} aria-label="Ajuda de" value={helpFrom || defFrom} onChange={(e) => setHelpFrom(e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-[#E4E0F3] bg-white px-2 text-sm text-[#1B1830]" />
                        <span>às</span>
                        <input type="time" step={300} aria-label="Ajuda até" value={helpTo || defTo} onChange={(e) => setHelpTo(e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-[#E4E0F3] bg-white px-2 text-sm text-[#1B1830]" />
                      </div>
                      <button onClick={callHelp} disabled={saving || !helpId} className="h-10 rounded-[20px] bg-[#17142E] px-4 text-sm font-semibold text-white disabled:opacity-40">
                        Chamar para {conf.label.replace(/ \(.*\)$/, "")}
                      </button>
                      {peaks.length > 0 && <p className="m-0 text-[11px] text-[#8A85A3]">O horário já vem no pico da loja ({peakLabel}); mude se precisar.</p>}
                    </div>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </>
      )}
    </section>
  );
};
