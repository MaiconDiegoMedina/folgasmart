import { useEffect, useRef, useState } from "react";
import { toMin, fromMin } from "@/lib/workloadTimes";

const STEP = 5; // minutos
const MIN_WORK = 30; // trecho mínimo antes/depois do intervalo
const LAST = 23 * 60 + 55;

// Calcula o novo horário a partir do original e do deslocamento em minutos
const shiftWith = (orig, mode, delta) => {
  const [s, ...rest] = orig;
  const e = rest[rest.length - 1];
  const brk = orig.length === 4 ? [orig[1], orig[2]] : null;
  if (mode === "move") {
    const d = Math.max(-s, Math.min(LAST - e, delta));
    return orig.map((m) => m + d);
  }
  if (mode === "start") {
    const limit = (brk ? brk[0] : e) - MIN_WORK;
    const ns = Math.max(0, Math.min(limit, s + delta));
    return [ns, ...orig.slice(1)];
  }
  if (mode === "end") {
    const limit = (brk ? brk[1] : s) + MIN_WORK;
    const ne = Math.min(LAST, Math.max(limit, e + delta));
    return [...orig.slice(0, -1), ne];
  }
  if (mode === "break" && brk) {
    const len = brk[1] - brk[0];
    const bs = Math.max(s + MIN_WORK, Math.min(e - MIN_WORK - len, brk[0] + delta));
    return [s, bs, bs + len, e];
  }
  return orig;
};

/**
 * Arrastar a barra do horário no gráfico do dia:
 * - corpo da barra: muda entrada e saída juntas (mantém a jornada)
 * - pontas: muda só a entrada ou só a saída (hora extra ou saída antes)
 * - parte listrada: move o intervalo
 * No celular: segure a barra um instante e arraste.
 * `onCommit(o, novoHorario)` salva; `preview` traz o horário enquanto arrasta.
 */
export const useShiftDrag = ({ span, onCommit }) => {
  const [preview, setPreview] = useState(null); // { key, shift }
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
      const p = {
        o, mode, key: o.key || o.emp.id, pid: e.pointerId, sx: e.clientX,
        mpp: span / track.getBoundingClientRect().width,
        orig: o.shift.map(toMin), touch: e.pointerType !== "mouse", live: false, next: null, timer: null,
      };
      ref.current = p;
      if (p.touch) {
        p.timer = setTimeout(() => {
          if (ref.current !== p) return;
          p.live = true;
          setPreview({ key: p.key, shift: o.shift, mode });
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
      if (!p.live) {
        if (Math.abs(dx) < 4) return;
        if (p.touch) return end(); // deslizou sem segurar: é rolagem
        p.live = true;
      }
      const delta = Math.round((dx * p.mpp) / STEP) * STEP;
      const next = shiftWith(p.orig, p.mode, delta);
      p.next = next;
      setPreview({ key: p.key, shift: next.map(fromMin), mode: p.mode });
    };
    const up = (e) => {
      const p = ref.current;
      if (!p || e.pointerId !== p.pid) return;
      end();
      if (p.live && p.next && p.next.some((m, i) => m !== p.orig[i])) commitRef.current(p.o, p.next.map(fromMin));
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
