import { useEffect, useState } from "react";
import { Loader2, Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errMsg, unlockAdmin, lockAdmin, adminUnlockedUntil } from "@/lib/api";

const fmtTime = (ms) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

// Hora até quando os dias passados estão desbloqueados (null = bloqueado)
export const useUnlock = () => {
  const [until, setUntil] = useState(adminUnlockedUntil());
  useEffect(() => {
    const sync = () => setUntil(adminUnlockedUntil());
    window.addEventListener("folgasmart:unlock-changed", sync);
    const timer = setInterval(sync, 30000); // o desbloqueio expira sozinho
    return () => {
      window.removeEventListener("folgasmart:unlock-changed", sync);
      clearInterval(timer);
    };
  }, []);
  return until;
};

export const openUnlock = () => window.dispatchEvent(new Event("folgasmart:locked"));

// Botão da escala: desbloquear / bloquear de novo
export const UnlockButton = () => {
  const until = useUnlock();
  return until ? (
    <button
      data-testid="btn-lock"
      onClick={lockAdmin}
      title="Bloquear de novo os dias que já passaram"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border border-[#FCD34D] bg-[#FFFBEB] text-[#B45309] hover:border-[#B45309]"
    >
      <LockOpen className="h-3.5 w-3.5" /> Desbloqueado até {fmtTime(until)} · bloquear
    </button>
  ) : (
    <button
      data-testid="btn-unlock"
      onClick={openUnlock}
      title="Dias que já passaram só aceitam falta e atestado. Para outras alterações, use a senha do administrador."
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border border-[#E5E1D8] bg-white text-[#575E65] hover:border-[#0F172A]"
    >
      <Lock className="h-3.5 w-3.5" /> Dias passados bloqueados
    </button>
  );
};

// Janela da senha do administrador; abre pelo botão ou quando o servidor recusa por bloqueio
export const UnlockDialog = () => {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const show = () => { setPassword(""); setOpen(true); };
    window.addEventListener("folgasmart:locked", show);
    return () => window.removeEventListener("folgasmart:locked", show);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    try {
      await unlockAdmin(password);
      toast.success(`Dias passados desbloqueados até ${fmtTime(adminUnlockedUntil())}. Repita a alteração.`);
      setOpen(false);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent data-testid="unlock-dialog" className="sm:max-w-sm">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Lock className="h-4 w-4" /> Escala bloqueada</DialogTitle>
            <DialogDescription>
              Dias que já passaram só aceitam falta e atestado. Para outras alterações, informe a senha do administrador (vale por 30 minutos).
            </DialogDescription>
          </DialogHeader>
          <input
            type="password"
            autoFocus
            autoComplete="off"
            placeholder="Senha do administrador"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-[#E5E1D8] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F172A]"
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={busy || !password} className="bg-[#0F172A] hover:bg-[#1E293B] text-white">
              {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Desbloquear
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
