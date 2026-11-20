import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Loader2, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { http, errMsg } from "@/lib/api";
import { STARTER_SHIFT } from "@/lib/workloadTimes";
import { convocationSummary, convocationLink, convocationLabel, fmtDuration, fmtDue, whatsappUrl, shortNotice, MIN_NOTICE_DAYS } from "@/lib/convocation";

// Convocação do intermitente: horário com intervalo, envio pelo WhatsApp e resposta (pelo link ou marcada aqui)

const fromTimes = (t) => ({
  start: t?.[0] || "", end: t?.[t.length - 1] || "",
  breakStart: t?.length === 4 ? t[1] : "", breakEnd: t?.length === 4 ? t[2] : "",
});
const timesOfConv = (c) => c?.start ? (c.break_start ? [c.start, c.break_start, c.break_end, c.end] : [c.start, c.end]) : null;
const fmtStamp = (iso) => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "";

const STATUS_TONE = {
  pending: "bg-[#E8EEF7] text-[#34507A]",
  accepted: "bg-[#E3F5EC] text-[#1D6B45]",
  declined: "bg-[#F1F5F9] text-[#64748B]",
};

const field = "h-10 w-full rounded-lg border border-[#E4E0F3] bg-white px-2.5 font-mono-data text-sm outline-none focus:border-[#17142E]";

export const ConvocationDialog = ({ target, week, onClose, onSchedule }) => {
  const { emp, day, date, conv, defaultShift } = target || {};
  const [form, setForm] = useState(fromTimes(null));
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    if (target) setForm(fromTimes(timesOfConv(conv) || defaultShift || STARTER_SHIFT));
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!target) return null;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const summary = convocationSummary(form);
  const status = conv?.status;
  const sameTimes = conv && JSON.stringify(fromTimes(timesOfConv(conv))) === JSON.stringify(form);
  const dayLabel = date.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

  const call = async (key, fn) => {
    setBusy(key);
    try { return await fn(); } catch (err) { toast.error(errMsg(err)); return null; } finally { setBusy(null); }
  };

  // Salva o horário (gera link novo) e abre o WhatsApp com a mensagem pronta
  const sendNew = async () => {
    if (summary.error) return toast.error(summary.error);
    // A janela abre já no clique: depois da resposta do servidor o navegador bloquearia o pop-up
    const win = window.open("about:blank", "_blank");
    const data = await call("send", () => http.put("/schedule/convocation", {
      employee_id: emp.id, week, day,
      start: form.start, end: form.end,
      break_start: form.breakStart || null, break_end: form.breakEnd || null,
    }).then((r) => r.data));
    if (!data) { win?.close(); return; }
    onSchedule(data);
    const saved = data.convocations?.[emp.id]?.[String(day)];
    const url = whatsappUrl(emp, saved, date);
    if (win) win.location.href = url; else window.location.href = url;
    toast.success(`Convocação de ${emp.name.split(" ")[0]} pronta no WhatsApp — é só tocar em enviar`);
    onClose();
  };

  const mark = async (value) => {
    const data = await call(value, () => http.put("/schedule/convocation/status", { employee_id: emp.id, week, day, status: value }).then((r) => r.data));
    if (!data) return;
    onSchedule(data);
    toast.success(value === "cancel" ? "Convocação cancelada" : value === "accepted" ? "Marcado como aceito" : "Marcado como recusado");
    onClose();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(convocationLink(conv.token));
      toast.success("Link copiado");
    } catch { toast.error("Não foi possível copiar o link."); }
  };

  const late = conv && shortNotice(conv, date);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="convocation-dialog" className="max-h-[92vh] overflow-y-auto rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{conv ? "Convocação" : "Convocar"} · {emp.name}</DialogTitle>
          <DialogDescription className="first-letter:uppercase">{dayLabel} · {emp.sector}</DialogDescription>
        </DialogHeader>

        {conv && (
          <div className="space-y-1 rounded-xl border border-[#EEEBFB] bg-[#FBFAFE] p-3 text-xs text-[#4A4566]">
            <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wider ${STATUS_TONE[status]}`}>{convocationLabel(conv)}</span>
            {conv.sent_at && <p>Enviada em {fmtStamp(conv.sent_at)}{status === "pending" && conv.due ? ` · resposta até ${fmtDue(conv.due)}` : ""}</p>}
            {conv.expired && <p>Sem resposta no prazo: pela CLT (art. 452-A), conta como recusa.</p>}
            {conv.answered_at && !conv.expired && <p>{status === "accepted" ? "Aceita" : "Recusada"} em {fmtStamp(conv.answered_at)} {conv.answered_by === "funcionario" ? "pelo funcionário (link)" : "· marcado pelo gestor"}</p>}
            {late && <p className="font-semibold text-[#7A5500]">Convocação com menos de {MIN_NOTICE_DAYS} dias de antecedência.</p>}
          </div>
        )}

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs font-semibold text-[#5E5880]"><span>Entrada</span>
              <input data-testid="conv-start" type="time" value={form.start} onChange={set("start")} className={field} />
            </label>
            <label className="space-y-1 text-xs font-semibold text-[#5E5880]"><span>Saída</span>
              <input data-testid="conv-end" type="time" value={form.end} onChange={set("end")} className={field} />
            </label>
            <label className="space-y-1 text-xs font-semibold text-[#5E5880]"><span>Saída p/ intervalo</span>
              <input data-testid="conv-break-start" type="time" value={form.breakStart} onChange={set("breakStart")} className={field} />
            </label>
            <label className="space-y-1 text-xs font-semibold text-[#5E5880]"><span>Volta do intervalo</span>
              <input data-testid="conv-break-end" type="time" value={form.breakEnd} onChange={set("breakEnd")} className={field} />
            </label>
          </div>
          <div data-testid="conv-summary" className={`rounded-lg px-3 py-2 text-xs ${summary.error ? "bg-[#FDE2E2] text-[#A12828]" : "bg-[#E3F5EC] text-[#1D6B45]"}`}>
            {summary.worked != null && <b>{fmtDuration(summary.worked)} trabalhadas · intervalo {summary.brk ? `${summary.brk} min` : "nenhum"}. </b>}
            {summary.error || "Intervalo dentro da regra."}
            {summary.rule && <span className="block opacity-80">Regra: {summary.rule}.</span>}
          </div>
          {!emp.phone && (
            <p className="text-xs text-[#7A5500]">Sem celular no cadastro: o WhatsApp vai pedir para você escolher o contato. Cadastre o celular em Funcionários.</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {(!conv || !sameTimes || status !== "pending") && (
            <Button data-testid="btn-conv-send" onClick={sendNew} disabled={!!busy || !!summary.error} className="h-11 rounded-full bg-[#1F9D55] text-white hover:bg-[#178246]">
              {busy === "send" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {conv ? (sameTimes ? "Convocar de novo pelo WhatsApp" : "Salvar novo horário e reenviar") : "Convocar pelo WhatsApp"}
            </Button>
          )}
          {conv && status === "pending" && sameTimes && (
            <div className="grid grid-cols-2 gap-2">
              <Button asChild data-testid="btn-conv-resend" className="h-11 rounded-full bg-[#1F9D55] text-white hover:bg-[#178246]">
                <a href={whatsappUrl(emp, conv, date)} target="_blank" rel="noreferrer"><Send className="mr-2 h-4 w-4" />Reenviar</a>
              </Button>
              <Button variant="outline" onClick={copyLink} className="h-11 rounded-full"><Copy className="mr-2 h-4 w-4" />Copiar link</Button>
            </div>
          )}
          {conv && (
            <>
              <p className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-[#8A84A6]">Resposta recebida por fora (telefone, pessoalmente)</p>
              <div className="grid grid-cols-2 gap-2">
                <Button data-testid="btn-conv-accept" variant="outline" disabled={!!busy || status === "accepted"} onClick={() => mark("accepted")} className="rounded-full border-[#8FD0AE] text-[#1D6B45]">
                  {busy === "accepted" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}Aceitou
                </Button>
                <Button data-testid="btn-conv-decline" variant="outline" disabled={!!busy || (status === "declined" && !conv.expired)} onClick={() => mark("declined")} className="rounded-full">
                  {busy === "declined" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <X className="mr-1.5 h-4 w-4" />}Recusou
                </Button>
              </div>
              <Button data-testid="btn-conv-cancel" variant="ghost" disabled={!!busy} onClick={() => mark("cancel")} className="rounded-full text-[#A12828] hover:bg-[#FDE2E2]">
                {busy === "cancel" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}Cancelar convocação
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
