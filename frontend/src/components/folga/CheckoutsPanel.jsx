import { useState } from "react";
import { Plus, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { http, errMsg } from "@/lib/api";

// Cadastro dos caixas (checkouts) que as operadoras vão operar
export const CheckoutsPanel = ({ checkouts, onChange }) => {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await http.post("/checkouts", { name: name.trim() });
      setName("");
      onChange();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c) => {
    if (!window.confirm(`Excluir o caixa "${c.name}"? Os dias em que alguém estava nele ficam sem caixa.`)) return;
    try {
      await http.delete(`/checkouts/${c.id}`);
      onChange();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <section data-testid="checkouts-panel" className="rounded-2xl border border-[#E5E1D8] bg-white p-5 sm:p-6">
      <p className="text-xs font-semibold tracking-[0.2em] uppercase text-[#8A929B]">Frente de caixa</p>
      <h3 className="font-display text-2xl font-bold tracking-tight mt-1 mb-4">Caixas</h3>
      <div className="flex flex-wrap gap-2 mb-4">
        {checkouts.length === 0 && <p className="text-sm text-[#8A929B]">Nenhum caixa cadastrado.</p>}
        {checkouts.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-1 rounded-full border border-[#E5E1D8] bg-[#F9F8F5] pl-3 pr-1 py-1 text-sm font-semibold">
            {c.name}
            <button onClick={() => remove(c)} aria-label={`Excluir ${c.name}`} className="p-0.5 rounded-full text-[#8A929B] hover:bg-[#FEF2F2] hover:text-[#DC2626]">
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
      </div>
      <form onSubmit={add} className="flex gap-2 max-w-md">
        <Input placeholder="Nome do caixa (ex.: Rápido 1, Preferencial)" value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
        <Button type="submit" size="sm" disabled={busy || !name.trim()} className="bg-[#0F172A] hover:bg-[#1E293B] text-white h-9">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </Button>
      </form>
      <p className="text-xs text-[#575E65] mt-3">
        O caixa de cada operadora é escolhido na sub-aba de horários do dia (setores com "caixa" no nome) e aparece na escala semanal.
      </p>
    </section>
  );
};
