import { toMin } from "@/lib/workloadTimes";
import { limitsOf } from "@/lib/useShiftDrag";

const fmtDur = (m) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
const STRIPES = "repeating-linear-gradient(135deg,rgba(255,255,255,.9) 0 3px,rgba(255,255,255,.35) 3px 6px)";

/**
 * Barra de horário arrastável do gráfico do dia (Caixas e setores).
 * shift: horário a mostrar (o do arrasto, enquanto arrasta); extra: minutos acima (+) ou abaixo (−) da jornada.
 * drag: estado do arrasto desta barra ({ dy, capped, mode }) ou null.
 */
export const ShiftBar = ({ o, shift, win, colors, title, grab, drag, extra = 0 }) => {
  if (!shift) return null;
  const { START, END, SPAN } = win;
  const a = toMin(shift[0]);
  const b = toMin(shift[shift.length - 1]);
  if (b <= START || a >= END) return null;
  const brk = shift.length === 4 ? [toMin(shift[1]), toMin(shift[2])] : null;
  const pct = (m) => `${(((m - START) / SPAN) * 100).toFixed(2)}%`;
  const width = (x, y) => `${(((y - x) / SPAN) * 100).toFixed(2)}%`;
  const from = Math.max(a, START);
  const to = Math.min(b, END);
  const first = o.emp.name.split(" ")[0];
  const dragging = !!drag;
  const lift = drag?.dy ? { transform: `translateY(${drag.dy}px)` } : {};
  const brkFree = !!(o.shift && limitsOf(o.base, o.shift.map(toMin)).brk);
  const handle = "absolute top-0 bottom-0 z-[3] w-2.5 cursor-ew-resize touch-none";
  return (
    <>
      <div
        {...grab(o, "move")}
        title={`${title} Arraste para mudar o horário ou para outra linha; puxe as pontas para mudar só a entrada ou a saída.`}
        className={`absolute top-[3px] bottom-[3px] flex cursor-grab select-none items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[10px] px-2.5 text-xs font-semibold [-webkit-touch-callout:none] active:cursor-grabbing ${colors.dashed ? "border-[1.5px] border-dashed border-[#B9B2DA] bg-white/60 text-[#4B3DA8]" : ""} ${dragging ? "pointer-events-none z-[6] shadow-[0_8px_20px_-8px_rgba(40,30,110,0.55)] ring-2 ring-[#6D5BD0]" : ""}`}
        style={{ left: pct(from), width: `calc(${width(from, to)} - 2px)`, ...(colors.dashed ? {} : { background: colors.bg, color: colors.ink }), ...lift }}
      >
        {a >= START && <span {...grab(o, "start")} className={`${handle} left-0`} aria-hidden="true" />}
        {first}
        {(to - from >= SPAN / 4 || dragging) && <i className="text-[11px] font-medium not-italic opacity-80">{shift[0]} – {shift[shift.length - 1]}</i>}
        {drag?.capped ? (
          <b className="rounded-md bg-[#A12828] px-1 text-[10px] font-bold text-white">{drag.capped}</b>
        ) : extra > 0 ? (
          <b className="rounded-md bg-[#6D5BD0] px-1 text-[10px] font-bold text-white" title={`${fmtDur(extra)} de hora extra`}>+{fmtDur(extra)}</b>
        ) : null}
        {extra < 0 && dragging && !drag?.capped && <b className="rounded-md bg-white/80 px-1 text-[10px] font-bold text-[#7A5500]">−{fmtDur(-extra)}</b>}
        {drag && (drag.mode === "brkStart" || drag.mode === "brkEnd") && brk && <b className="rounded-md bg-[#17142E] px-1 text-[10px] font-bold text-white">intervalo {fmtDur(brk[1] - brk[0])}</b>}
        {b <= END && <span {...grab(o, "end")} className={`${handle} right-0`} aria-hidden="true" />}
      </div>
      {brk && brk[1] > START && brk[0] < END && (
        <div
          {...grab(o, "break")}
          title={`Intervalo de ${first} · ${shift[1]}–${shift[2]} (${fmtDur(brk[1] - brk[0])}). Arraste para mudar o horário do intervalo${brkFree ? "; puxe as pontas para durar de 1h a 2h" : ""}.`}
          className={`absolute top-[3px] bottom-[3px] z-[7] cursor-grab select-none active:cursor-grabbing ${dragging ? "pointer-events-none" : ""}`}
          style={{ left: pct(Math.max(brk[0], START)), width: width(Math.max(brk[0], START), Math.min(brk[1], END)), background: STRIPES, ...lift }}
        >
          {brkFree && brk[0] >= START && <span {...grab(o, "brkStart")} className="absolute -left-1 top-0 bottom-0 w-2 cursor-ew-resize touch-none" aria-hidden="true" />}
          {brkFree && brk[1] <= END && <span {...grab(o, "brkEnd")} className="absolute -right-1 top-0 bottom-0 w-2 cursor-ew-resize touch-none" aria-hidden="true" />}
        </div>
      )}
    </>
  );
};

export { fmtDur };

// Cor do cartão: verde = bate com a jornada; amarelo = hora extra; vermelho = trabalhando fora da jornada
// (dia de folga ou mais de 6 dias seguidos)
export const dayStatus = ({ shift, base, streak, offDay }) => {
  if (offDay) return { lvl: "risk", tag: "Dia de folga", note: "Fora da jornada: trabalhando no dia de folga" };
  if (streak) return { lvl: "risk", tag: "+6 dias", note: "Fora da jornada: passou de 6 dias seguidos" };
  if (shift && base) {
    const t = shift.map(toMin);
    const w = t[t.length - 1] - t[0] - (t.length === 4 ? t[2] - t[1] : 0);
    if (w > base) return { lvl: "warn", tag: `Hora extra +${fmtDur(w - base)}`, note: `Hora extra: ${fmtDur(w - base)} além da jornada` };
    if (w < base) return { lvl: "ok", tag: `Jornada −${fmtDur(base - w)}`, note: `Na jornada, com ${fmtDur(base - w)} a menos hoje` };
  }
  return { lvl: "ok", tag: "Na jornada", note: "Na jornada" };
};

// Texto das horas do dia: só a jornada, ou jornada e horas de hoje quando há ajuste
export const dayLabel = (s, base) => {
  if (!s) return "sem horário";
  const t = s.map(toMin);
  const w = t[t.length - 1] - t[0] - (t.length === 4 ? t[2] - t[1] : 0);
  if (!base || w === base) return `${fmtDur(w)} por dia`;
  return `jornada ${fmtDur(base)} · hoje ${fmtDur(w)} (${w > base ? "+" : "−"}${fmtDur(Math.abs(w - base))})`;
};
