import { useEffect, useState } from "react";
import { PageTitle } from "@/components/folga/Header";
import { DAYS, DAYS_SHORT, weekDates, isoDate, fmtDayMonth, http } from "@/lib/api";
import { isIntermittent, acceptedOn } from "@/lib/convocation";
import { isTrial } from "@/components/folga/RoleDialog";
import { peakHours } from "@/lib/hourlyReport";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const TONE = {
  ok: { background: "#E3F5EC", color: "#1D6B45" },
  warn: { background: "#FFF4D1", color: "#7A5500" },
  risk: { background: "#FDE2E2", color: "#A12828" },
  folga: { background: "#F2F0F8", color: "#4A4566" },
  ferias: { background: "#E6F2F1", color: "#2E5F5B" },
  atestado: { background: "#E8EEF7", color: "#34507A" },
};
const RING = { ok: ["#2E9E66", "#E3F5EC"], warn: ["#E0B13A", "#FFF4D1"], risk: ["#D9534F", "#FDE2E2"] };
const CHIP = "inline-flex h-[26px] shrink-0 items-center whitespace-nowrap rounded-[13px] px-2.5 text-xs font-semibold";
const CARD = "glass rounded-[26px] p-[22px]";
const BTN_SM = "inline-flex h-9 shrink-0 items-center rounded-[18px] px-3.5 text-[13px] font-semibold";
const levelOf = (r) => (r >= 0.75 ? "ok" : r >= 0.6 ? "warn" : "risk");
const initials = (n) => n.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const hello = () => {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
};

const Avatar = ({ name, tone }) => (
  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold" style={tone || { background: "#E6E1FA", color: "#4B3DA8" }}>{initials(name)}</div>
);

// Resumo do dia: equipe de hoje, setores, movimento, alertas e quem folga amanhã
export const HomePanel = ({ employees, schedule, movement, week, onTab }) => {
  const dates = weekDates(week);
  const todayIso = isoDate(new Date());
  const idx = dates.findIndex((d) => isoDate(d) === todayIso);
  const day = idx >= 0 ? idx : 0;
  const [hourly, setHourly] = useState([]);
  useEffect(() => {
    http.get("/hourly", { params: { week } }).then(({ data }) => setHourly(data || [])).catch(() => setHourly([]));
  }, [week]);

  const has = (key, id, d) => (schedule[key]?.[id] || []).includes(d);
  const closedOn = (d) => (schedule.closed_days || []).includes(d);
  const works = (e, d) => {
    if (closedOn(d) || has("vacation_days", e.id, d) || has("sick_days", e.id, d)) return false;
    if (isIntermittent(e)) return acceptedOn(schedule, e.id, d);
    return (!has("off_days", e.id, d) || has("extra_days", e.id, d)) && !has("suspension_days", e.id, d) && !has("absence_days", e.id, d);
  };
  const awayKind = (e, d) => (has("vacation_days", e.id, d) ? "ferias" : has("sick_days", e.id, d) ? "atestado" : null);
  const inPlay = (d) => employees.filter((e) => !isIntermittent(e) || acceptedOn(schedule, e.id, d));

  const team = inPlay(day);
  const working = team.filter((e) => works(e, day));
  const away = team.filter((e) => awayKind(e, day));
  const off = team.length - working.length - away.length;
  const ratio = team.length ? working.length / team.length : 1;
  const lvl = levelOf(ratio);

  const byId = Object.fromEntries(employees.map((e) => [e.id, e]));
  const streak = Object.entries(schedule.streak_alerts || {}).filter(([id, days]) => byId[id] && days?.length);
  const cct = Object.entries(schedule.cct_alerts || {}).filter(([id, msg]) => byId[id] && msg);
  const trial = employees.filter(isTrial);
  const notGenerated = !schedule.generated_at;
  const risks = streak.length;
  const warns = cct.length + trial.length + (notGenerated ? 1 : 0);

  const holidays = Object.entries(schedule.holidays || {}).map(([d, h]) => ({ d: Number(d), ...h })).sort((a, b) => a.d - b.d);
  const holiday = holidays.find((h) => h.d >= day) || holidays[0];
  const peaks = movement?.peak_days || [];

  // Setores de hoje
  const sectors = [...new Set(team.map((e) => e.sector || "Sem setor"))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const sectorRows = sectors.map((s) => {
    const all = team.filter((e) => (e.sector || "Sem setor") === s);
    const on = all.filter((e) => works(e, day)).length;
    const out = all.length - on;
    return { s, on, total: all.length, out, lvl: levelOf(all.length ? on / all.length : 1) };
  });

  // Movimento de hoje
  const hours = (hourly.find((h) => h.day === day)?.hours || []).filter((h) => h.clients > 0).sort((a, b) => a.hour - b.hour);
  const maxC = Math.max(1, ...hours.map((h) => h.clients));
  const pk = peakHours(hours);
  const peakTxt = pk.length ? `${Math.min(...pk)}h–${Math.max(...pk) + 1}h` : null;
  const nextPeak = [...Array(7)].map((_, i) => (day + i + 1) % 7).find((d) => peaks.includes(d));
  const labels = hours.length ? [0, 0.25, 0.5, 0.75, 1].map((f) => hours[Math.round(f * (hours.length - 1))].hour) : [];

  // Amanhã
  const tom = day + 1;
  const tomorrow = tom <= 6
    ? inPlay(tom).filter((e) => !works(e, tom)).map((e) => ({ e, kind: awayKind(e, tom) || "folga" }))
    : [];

  const d0 = dates[day];
  const end = dates[6];
  const eyebrow = `${DAYS[day]}-feira, ${d0.getDate()} de ${MONTHS[d0.getMonth()]} · semana ${dates[0].getDate()} – ${end.getDate()} ${MONTHS_SHORT[end.getMonth()]}`.replace("Sábado-feira", "Sábado").replace("Domingo-feira", "Domingo");

  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        eyebrow={idx < 0 ? `${eyebrow} · semana selecionada` : eyebrow}
        actions={
          <button onClick={() => onTab("escala")} className="inline-flex h-11 items-center gap-2 rounded-[22px] bg-[#6D5BD0] px-[18px] text-sm font-semibold text-white hover:bg-[#5B4BC4]">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>
            Gerar escala
          </button>
        }
      >
        {hello()}, <em>vamos escalar</em>
      </PageTitle>

      <section className="grid gap-[18px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <button onClick={() => onTab("escala")} className={`${CARD} text-left`}>
          <p className="m-0 text-[13px] font-semibold text-[#5E5880]">Trabalhando hoje</p>
          <p className="mt-2 font-display text-[44px] font-semibold leading-none tracking-[-1px]">{working.length}<small className="text-lg font-medium text-[#5E5880]"> / {team.length}</small></p>
          <div className="mt-4 flex h-2 gap-1">
            {working.length > 0 && <div className="rounded" style={{ flex: working.length, background: RING[lvl][0] }} />}
            {team.length > working.length && <div className="rounded bg-[#F2F0F8]" style={{ flex: team.length - working.length }} />}
          </div>
          <span className={`${CHIP} mt-3`} style={TONE[lvl]}>{lvl === "ok" ? "Ok" : lvl === "warn" ? "Atenção" : "Risco"} · {Math.round(ratio * 100)}% da equipe</span>
        </button>
        <button onClick={() => onTab("escala")} className={`${CARD} text-left`}>
          <p className="m-0 text-[13px] font-semibold text-[#5E5880]">De folga hoje</p>
          <p className="mt-2 font-display text-[44px] font-semibold leading-none tracking-[-1px]">{off}</p>
          <p className="mt-3 text-[13px] text-[#5E5880]">{away.length ? `+ ${away.length} de atestado ou férias` : "ninguém de férias ou atestado"}</p>
        </button>
        <button onClick={() => onTab("escala")} className="rounded-[26px] border p-[22px] text-left" style={risks ? { background: "#FDE2E2", borderColor: "#EE9A9A", color: "#A12828" } : warns ? { background: "#FFF4D1", borderColor: "#F2CF6B", color: "#7A5500" } : { background: "#E3F5EC", borderColor: "#8FD0AE", color: "#1D6B45" }}>
          <p className="m-0 text-[13px] font-semibold">Precisa de atenção</p>
          <p className="mt-2 font-display text-[44px] font-semibold leading-none tracking-[-1px]">{risks + warns}</p>
          <p className="mt-3 text-[13px]">{risks + warns ? `${risks} ${risks === 1 ? "risco" : "riscos"} · ${warns} ${warns === 1 ? "ponto" : "pontos"} de atenção` : "Tudo certo nesta semana"}</p>
        </button>
        {holiday ? (
          <button onClick={() => onTab("feriados")} className={`${CARD} text-left`}>
            <p className="m-0 text-[13px] font-semibold text-[#5E5880]">Feriado nesta semana</p>
            <p className="mt-2.5 font-display text-xl font-semibold leading-tight">{DAYS_SHORT[holiday.d]}, {fmtDayMonth(dates[holiday.d])}</p>
            <p className="mt-1.5 text-[13px] text-[#5E5880]">{holiday.name} · {holiday.closed ? "loja fechada" : "loja aberta, pagamento em dobro"}</p>
            <span className={`${CHIP} mt-2.5`} style={holiday.closed ? TONE.ok : TONE.warn}>{holiday.closed ? "Ok · loja fechada" : "Atenção · custo 2×"}</span>
          </button>
        ) : (
          <button onClick={() => onTab("movimento")} className={`${CARD} text-left`}>
            <p className="m-0 text-[13px] font-semibold text-[#5E5880]">Dias de pico</p>
            <p className="mt-2.5 font-display text-xl font-semibold leading-tight">{peaks.length ? peaks.map((d) => DAYS_SHORT[d]).join(", ") : "Nenhum marcado"}</p>
            <p className="mt-1.5 text-[13px] text-[#5E5880]">Sem feriado nesta semana.</p>
            {peaks.includes(day) && <span className={`${CHIP} mt-2.5`} style={TONE.warn}>Hoje é dia de pico</span>}
          </button>
        )}
      </section>

      <section className="flex flex-wrap gap-[18px]">
        <div className={`${CARD} min-w-0`} style={{ flex: "2 1 520px" }}>
          <div className="mb-[18px] flex items-center justify-between">
            <h2 className="m-0 text-lg font-bold">Hoje na loja, por setor</h2>
            <button onClick={() => onTab("escala")} className={`${BTN_SM} border border-[#E4E0F3] bg-white/80`}>Ver escala</button>
          </div>
          {closedOn(day) ? (
            <p className="m-0 text-sm text-[#5E5880]">Loja fechada hoje.</p>
          ) : (
            <div className="grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              {sectorRows.map((r) => {
                const p = r.total ? Math.round((r.on / r.total) * 100) : 0;
                return (
                  <div key={r.s} className="flex items-center gap-3 rounded-[18px] border border-[#EFECF8] bg-white/80 p-3">
                    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${RING[r.lvl][0]} 0 ${p}%, ${RING[r.lvl][1]} 0)` }}>
                      <span className="grid h-11 w-11 place-items-center rounded-full bg-white font-display text-xs font-semibold">{r.on}/{r.total}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="m-0 truncate font-semibold">{r.s}</p>
                      <p className="m-0 text-[13px] text-[#5E5880]">{r.out ? `${r.out} de folga` : "Todos trabalhando"}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3.5 rounded-[26px] bg-[#17142E] p-[22px] text-white" style={{ flex: "1 1 320px" }}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-lg font-bold">Movimento de hoje</h2>
            {peakTxt && <span className={CHIP} style={{ background: "#F2CF6B", color: "#3A2A00" }}>Pico {peakTxt}</span>}
          </div>
          <p className="m-0 text-[13px] text-[#C9C4E6]">Clientes por hora ({DAYS[day].toLowerCase()})</p>
          {hours.length ? (
            <>
              <div className="flex h-[150px] items-end gap-1.5 pt-2.5">
                {hours.map((h) => (
                  <div key={h.hour} title={`${h.hour}h · ${h.clients} clientes`} className="flex-1 rounded-md" style={{ height: `${Math.max(4, (h.clients / maxC) * 100)}%`, background: pk.includes(h.hour) ? "#F2C94C" : h.clients / maxC > 0.6 ? "#7C6AE0" : "#3A3463" }} />
                ))}
              </div>
              <div className="flex justify-between text-[11px] text-[#A9A3C9]">{labels.map((h, i) => <span key={i}>{h}h</span>)}</div>
            </>
          ) : (
            <p className="m-0 py-8 text-center text-[13px] text-[#C9C4E6]">Sem movimento por hora para hoje. Importe o relatório na aba Movimento.</p>
          )}
          <div className="mt-auto flex gap-2.5">
            <div className="flex-1 rounded-2xl bg-[#221E3D] p-3">
              <p className="m-0 text-xs text-[#C9C4E6]">Clientes na hora de pico</p>
              <p className="mt-1 font-display text-[22px] font-semibold">{hours.length ? maxC : "—"}</p>
            </div>
            <div className="flex-1 rounded-2xl bg-[#221E3D] p-3">
              <p className="m-0 text-xs text-[#C9C4E6]">Próximo pico</p>
              <p className="mt-1 font-display text-[22px] font-semibold">{nextPeak === undefined ? "—" : nextPeak === day ? "Hoje" : DAYS_SHORT[nextPeak]}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-wrap gap-[18px]">
        <div className={`${CARD} min-w-0`} style={{ flex: "3 1 520px" }}>
          <h2 className="mb-4 text-lg font-bold">Precisa de atenção</h2>
          <div className="flex flex-col gap-2.5">
            {notGenerated && (
              <div className="flex flex-wrap items-center gap-3 rounded-[18px] border border-[#EFECF8] bg-white/80 p-3">
                <div className="min-w-0 flex-1"><p className="m-0 font-semibold">Escala da semana</p><p className="m-0 text-[13px] text-[#5E5880]">A escala desta semana ainda não foi gerada.</p></div>
                <span className={CHIP} style={TONE.warn}>Atenção · não gerada</span>
                <button onClick={() => onTab("escala")} className={`${BTN_SM} bg-[#17142E] text-white`}>Gerar</button>
              </div>
            )}
            {streak.map(([id, days]) => {
              const e = byId[id];
              const last = days[days.length - 1];
              return (
                <div key={id} className="flex flex-wrap items-center gap-3 rounded-[18px] border border-[#EE9A9A] bg-[#FFF1F1] p-3">
                  <Avatar name={e.name} tone={TONE.risk} />
                  <div className="min-w-0 flex-1" style={{ flexBasis: 200 }}>
                    <p className="m-0 font-semibold">{e.name}{e.sector ? ` · ${e.sector}` : ""}</p>
                    <p className="m-0 text-[13px] text-[#5E5880]">Passa de 6 dias seguidos sem folga até {DAYS[last].toLowerCase()}. O máximo é 6.</p>
                  </div>
                  <span className={CHIP} style={TONE.risk}>Risco · +6 DIAS no {DAYS_SHORT[last].toLowerCase()} {dates[last].getDate()}</span>
                  <button onClick={() => onTab("escala")} className={`${BTN_SM} bg-[#17142E] text-white`}>Dar folga</button>
                </div>
              );
            })}
            {cct.map(([id, msg]) => {
              const e = byId[id];
              return (
                <div key={id} className="flex flex-wrap items-center gap-3 rounded-[18px] border border-[#EFECF8] bg-white/80 p-3">
                  <Avatar name={e.name} />
                  <div className="min-w-0 flex-1" style={{ flexBasis: 200 }}>
                    <p className="m-0 font-semibold">{e.name}{e.sector ? ` · ${e.sector}` : ""}</p>
                    <p className="m-0 text-[13px] text-[#5E5880]">{String(msg).replace(/^CCT:\s*/i, "")}</p>
                  </div>
                  <span className={CHIP} style={TONE.warn}>Atenção · CCT</span>
                  <button onClick={() => onTab("escala")} className={`${BTN_SM} border border-[#E4E0F3] bg-white/80`}>Ajustar</button>
                </div>
              );
            })}
            {trial.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-3 rounded-[18px] border border-[#EFECF8] bg-white/80 p-3">
                <Avatar name={e.name} tone={TONE.atestado} />
                <div className="min-w-0 flex-1" style={{ flexBasis: 200 }}>
                  <p className="m-0 font-semibold">{e.name} · em teste</p>
                  <p className="m-0 text-[13px] text-[#5E5880]">Aguardando sua aprovação de cargo e setor.</p>
                </div>
                <span className={CHIP} style={TONE.warn}>Atenção · pendente</span>
                <button onClick={() => onTab("funcionarios")} className={`${BTN_SM} border border-[#E4E0F3] bg-white/80`}>Aprovar</button>
              </div>
            ))}
            {!risks && !warns && <p className="m-0 rounded-[18px] p-3 text-sm" style={TONE.ok}>Tudo certo: nenhum alerta nesta semana.</p>}
          </div>
        </div>

        <div className={`${CARD} min-w-0`} style={{ flex: "2 1 320px" }}>
          <h2 className="mb-4 text-lg font-bold">{tom <= 6 ? `Folgam amanhã · ${DAYS_SHORT[tom].toLowerCase()} ${fmtDayMonth(dates[tom])}` : "Folgam amanhã"}</h2>
          {tom > 6 ? (
            <p className="m-0 text-sm text-[#5E5880]">Amanhã começa a próxima semana. Veja na Escala.</p>
          ) : closedOn(tom) ? (
            <p className="m-0 text-sm text-[#5E5880]">Loja fechada amanhã.</p>
          ) : !tomorrow.length ? (
            <p className="m-0 text-sm text-[#5E5880]">Ninguém folga amanhã.</p>
          ) : (
            <div className="flex max-h-[360px] flex-col gap-2.5 overflow-y-auto pr-1">
              {tomorrow.map(({ e, kind }) => (
                <div key={e.id} className="flex items-center gap-3">
                  <Avatar name={e.name} tone={kind === "folga" ? undefined : TONE[kind]} />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate font-semibold">{e.name}</p>
                    <p className="m-0 text-[13px] text-[#5E5880]">{e.sector || "Sem setor"}</p>
                  </div>
                  <span className={CHIP} style={TONE[kind]}>{kind === "folga" ? "Folga" : kind === "ferias" ? "Férias" : "Atestado"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
