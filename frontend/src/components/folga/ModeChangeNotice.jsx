import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { http, parseIso, DAYS } from "@/lib/api";
import { modelDesc } from "@/lib/scaleModels";

const fmtDate = (iso) => {
  const d = parseIso(iso);
  return `${DAYS[(d.getDay() + 6) % 7].toLowerCase()}, ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// Aviso a cada acesso na semana anterior a uma troca de escala (ex.: 5x2 com 42h a partir de 14/12)
export const ModeChangeNotice = ({ models }) => {
  const [notices, setNotices] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    http.get("/notices").then(({ data }) => {
      setNotices(data || []);
      if (data?.length) setOpen(true);
    }).catch(() => {});
  }, []);
  if (!notices.length) return null;
  const first = notices[0];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="mode-change-notice" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-[#6D5BD0]" /> A escala vai mudar</DialogTitle>
          <DialogDescription>A partir de {fmtDate(first.start_week)}, a escala muda:</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {notices.map((n, i) => {
            const m = n.model || models.find((x) => x.id === n.mode);
            return (
              <li key={i} className="rounded-2xl border border-[#E4E0F3] bg-[#F7F5FC] px-4 py-3 text-sm">
                <b>{n.sector === "*" ? "Todos os setores" : n.sector}</b> passa{n.sector === "*" ? "m" : ""} para <b>{m?.name || n.mode}</b>
                {notices.some((x) => x.start_week !== first.start_week) && <> em {fmtDate(n.start_week)}</>}
                {m && <span className="mt-0.5 block text-xs text-[#5E5880]">{modelDesc(m)}</span>}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-[#5E5880]">
          As semanas a partir dessa data são geradas com a nova escala. Os horários das jornadas são ajustados sozinhos.
          O administrador pode mudar a escala de um setor em Configurações › Escalas.
        </p>
        <DialogFooter>
          <Button onClick={() => setOpen(false)} className="bg-[#17142E] text-white hover:bg-[#2A2550]">Entendi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
