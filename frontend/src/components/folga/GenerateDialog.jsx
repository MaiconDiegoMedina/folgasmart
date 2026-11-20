import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { scaleModels, modeLabel, modelDesc } from "@/lib/scaleModels";

const KEEP = "manter";

// Pergunta a escala (6x1 ou 5x2) antes de gerar. Em "Todos", também dá para manter a escala de cada setor.
export const GenerateDialog = ({ open, onOpenChange, sector, sectors, modeOf, regenerating, onConfirm }) => {
  const all = !sector;
  const modes = [...new Set((all ? sectors : [sector]).map(modeOf))];
  const initial = all && modes.length > 1 ? KEEP : modes[0] || "6x1";
  const [choice, setChoice] = useState(initial);
  useEffect(() => { if (open) setChoice(initial); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const MODES = scaleModels().map((m) => ({ id: m.id, title: m.name, desc: modelDesc(m) }));
  const options = all ? [...MODES, { id: KEEP, title: "Manter a de cada setor", desc: sectors.map((s) => `${s}: ${modeLabel(modeOf(s))}`).join(" · ") }] : MODES;
  const confirm = () => {
    onOpenChange(false);
    onConfirm(choice === KEEP ? null : choice);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="generate-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Gerar escala · {all ? "todos os setores" : sector}</DialogTitle>
          <DialogDescription>Qual escala usar{all ? " nos setores" : " neste setor"}?</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              data-testid={`generate-mode-${o.id}`}
              onClick={() => setChoice(o.id)}
              className={`rounded-2xl border-[1.5px] px-4 py-3 text-left transition-colors ${choice === o.id ? "border-[#6D5BD0] bg-[#EEEBFB]" : "border-[#E4E0F3] bg-white hover:border-[#B9AEF0]"}`}
            >
              <span className={`block text-sm font-bold ${o.id === KEEP ? "" : "font-mono-data"} text-[#1B1830]`}>{o.title}</span>
              <span className="block text-xs text-[#5E5880]">{o.desc}</span>
            </button>
          ))}
        </div>
        {regenerating && (
          <p className="rounded-xl bg-[#FFF4D1] px-3 py-2 text-xs text-[#7A5500]">
            A escala desta semana já foi gerada. Os ajustes manuais {all ? "da semana" : "desse setor nesta semana"} serão refeitos{all ? "" : "; os outros setores não mudam"}.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button data-testid="btn-generate-confirm" onClick={confirm} className="bg-[#6D5BD0] text-white hover:bg-[#5B4BC4]">
            <Sparkles className="mr-2 h-4 w-4" /> Gerar escala
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
