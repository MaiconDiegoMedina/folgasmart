import { useEffect, useRef, useState } from "react";
import { toMin, fromMin } from "@/lib/workloadTimes";

const STEP = 5; // minutos
const MIN_WORK = 30; // trecho mínimo antes/depois do intervalo
const LAST = 23 * 60 + 55;
const SIX_HOURS = 6 * 60;
export const MAX_EXTRA = 2 * 60; // hora extra por dia para jornada acima de 6h (até 6h: sem hora extra)
export const BREAK_RANGE = [60, 120]; // intervalo de 1h a 2h para quem trabalha mais de 6h

const workOf = (t) => t[t.length - 1] - t[0] - (t.length === 4 ? t[2] - t[1] : 0);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Horas extras permitidas no dia: até 2h para jornada acima de 6h; nenhuma para jornada de até 6h
export const extraAllowed = (base) => (base > SIX_HOURS ? MAX_EXTRA : 0);

// Limites do arrasto: hora extra (2h acima de 6h, nenhuma até 6h) e intervalo de 1h a 2h acima de 6h
export const limitsOf = (base, orig) => {
  const work = workOf(orig);
  return {
    maxWork: base ? Math.max(base + extraAllowed(base), work) : null,
    capLabel: base && base > SIX_HOURS ? "máx. 2h extra" : "sem hora extra",
    brk: orig.length === 4 && Math.max(work, base || 0) > SIX_HOURS ? BREAK_RANGE : null,
  };
};

// Novo horário a partir do original e do deslocamento em minutos; capped = bateu no limite de hora extra
const shiftWith = (orig, mode, delta, lim) => {
  const s = orig[0];
  const e = orig[orig.length - 1];
  const brk = orig.length === 4 ? [orig[1], orig[2]] : null;
  const blen = brk ? brk[1] - brk[0] : 0;
  const max = lim.maxWork;
  if (mode === "move") {
    const d = clamp(delta, -s, LAST - e);
    return { next: orig.map((m) => m + d), capped: false };
  }
  if (mode === "start") {
    let lo = 0;
    if (max) lo = Math.max(lo, e - blen - max);
    const want = s + delta;
    const ns = clamp(want, lo, (brk ? brk[0] : e) - MIN_WORK);
    return { next: [ns, ...orig.slice(1)], capped: !!max && want < lo };
  }
  if (mode === "end") {
    let hi = LAST;
    if (max) hi = Math.min(hi, s + blen + max);
    const want = e + delta;
    const ne = clamp(want, (brk ? brk[1] : s) + MIN_WORK, hi);
    return { next: [...orig.slice(0, -1), ne], capped: !!max && want > hi };
  }
  if (!brk) return { next: orig, capped: false };
  if (mode === "break") {
    const bs = clamp(brk[0] + delta, s + MIN_WORK, e - MIN_WORK - blen);
    return { next: [s, bs, bs + blen, e], capped: false };
  }
  // Pontas do intervalo: muda a duração dentro de 1h–2h (e sem passar da hora extra permitida)
  const [bmin, bmax] = lim.brk || [blen, blen];
  const minLen = Math.max(bmin, max ? e - s - max : 0);
  if (mode === "brkStart") {
    const bs = clamp(brk[0] + delta, Math.max(s + MIN_WORK, brk[1] - bmax), brk[1] - minLen);
    return { next: [s, bs, brk[1], e], capped: false };
  }
  if (mode === "brkEnd") {
    const be = clamp(brk[1] + delta, brk[0] + minLen, Math.min(e - MIN_WORK, brk[0] + bmax));
    return { next: [s, brk[0], be, e], capped: false };
  }
  return { next: orig, capped: false };
};

/**
 * Arrastar a barra do horário no gráfico do dia:
 * - corpo da barra: muda entrada e saída juntas (mantém a jornada); para cima/baixo troca de linha (caixa)
 * - pontas: muda só a entrada ou só a saída (hora extra até 2h para quem trabalha mais de 6h)
 * - parte listrada: move o intervalo; as pontas dela mudam a duração (1h a 2h para quem trabalha mais de 6h)
 * No celular: segure a barra um instante e arraste.
 * `onCommit(o, novoHorario | null, linhaDestino | null)` salva.
 */
export const useShiftDrag = ({ span, onCommit }) => {
  const [preview, setPreview] = useState(null); // { key, shift, mode, dy, row, capped }
  const ref = useRef(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  const grab = (o, mode) => ({
    onPointerDown: (e) => {
      if (!o.shift || (e.pointerType === "mouse" && e.button !== 0)) return;
      e.stopPropagation();
      const track = e.currentTarget.closest("[data-track]");
      if (!track) return;
      if (e.pointerType === "mouse") e.preventDefault();
      if (ref.current?.timer) clearTimeout(ref.current.timer);
      const orig = o.shift.map(toMin);
      const rowEl = track.closest("[data-row]");
      const p = {
        o, mode, key: o.key || o.emp.id, pid: e.pointerId, sx: e.clientX, sy: e.clientY,
        mpp: span / track.getBoundingClientRect().width, orig, lim: limitsOf(o.base, orig),
        fromRow: rowEl?.getAttribute("data-row") || null, row: null,
        touch: e.pointerType !== "mouse", live: false, next: null, timer: null,
      };
      ref.current = p;
      if (p.touch) {
        p.timer = setTimeout(() => {
          if (ref.current !== p) return;
          p.live = true;
          setPreview({ key: p.key, shift: o.shift, mode, dy: 0, row: null, capped: false });
          if (navigator.vibrate) navigator.vibrate(15);
        }, 280);
      }
    },
    onDragStart: (e) => e.preventDefault(),
    onContextMenu: (e) => {
      if (ref.current) e.preventDefault();
    },
  });

  useEffect(() => {
    const end = () => {
      if (ref.current?.timer) clearTimeout(ref.current.timer);
      ref.current = null;
      setPreview(null);
    };
    const move = (e) => {
      const p = ref.current;
      if (!p || e.pointerId !== p.pid) return;
      const dx = e.clientX - p.sx;
      const dy = e.clientY - p.sy;
      if (!p.live) {
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        if (p.touch) return end(); // deslizou sem segurar: é rolagem
        p.live = true;
      }
      // Linha de destino (outro caixa): só ao arrastar o corpo da barra num gráfico com linhas
      let row = null;
      if (p.mode === "move" && p.fromRow !== null) {
        const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-row]")?.getAttribute("data-row");
        row = hit && hit !== p.fromRow ? hit : null;
      }
      p.row = row;
      // Movendo para outro caixa quase na vertical, o horário fica como está
      const effDx = row && Math.abs(dx) < 12 ? 0 : dx;
      const delta = Math.round((effDx * p.mpp) / STEP) * STEP;
      const { next, capped } = shiftWith(p.orig, p.mode, delta, p.lim);
      p.next = next;
      setPreview({ key: p.key, shift: next.map(fromMin), mode: p.mode, dy: p.fromRow !== null && p.mode === "move" ? dy : 0, row, capped: capped ? p.lim.capLabel : null });
    };
    const up = (e) => {
      const p = ref.current;
      if (!p || e.pointerId !== p.pid) return;
      end();
      if (!p.live) return;
      const changed = p.next && p.next.some((m, i) => m !== p.orig[i]);
      if (changed || p.row) commitRef.current(p.o, changed ? p.next.map(fromMin) : null, p.row);
    };
    const block = (e) => {
      if (ref.current?.live) e.preventDefault();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", end);
    window.addEventListener("touchmove", block, { passive: false });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("touchmove", block);
    };
  }, []);

  // Horário a mostrar (o do arrasto, se for essa barra)
  const shiftFor = (o) => (preview && preview.key === (o.key || o.emp.id) ? preview.shift : o.shift);
  return { grab, preview, shiftFor };
};

// Corpo do pedido PUT /shifts
export const shiftPayload = (s) =>
  s.length === 4 ? { start: s[0], break_start: s[1], break_end: s[2], end: s[3] } : { start: s[0], break_start: null, break_end: null, end: s[s.length - 1] };
