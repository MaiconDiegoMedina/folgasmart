import { useEffect, useState } from "react";
import axios from "axios";
import { CalendarDays, Check, Clock, Coffee, Loader2, MapPin, X } from "lucide-react";
import { API } from "@/lib/api";

// Página que o intermitente abre pelo link do WhatsApp: vê o dia e o horário e aceita ou recusa (sem login)

const fmtDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
};
const fmtDue = (iso) => new Date(iso).toLocaleString("pt-BR", {
  weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
});
const detailOf = (e) => e?.response?.data?.detail || "Não foi possível carregar a convocação. Tente de novo em instantes.";

export default function ConvocationAnswer({ token }) {
  const [conv, setConv] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const url = `${API}/public/convocations/${encodeURIComponent(token)}`;

  useEffect(() => {
    document.title = "Convocação de trabalho";
    axios.get(url).then(({ data }) => setConv(data)).catch((e) => setError(detailOf(e)));
  }, [url]);

  const answer = async (value) => {
    setBusy(value);
    setError("");
    try {
      const { data } = await axios.post(url, { answer: value });
      setConv(data);
    } catch (e) {
      setError(detailOf(e));
      axios.get(url).then(({ data }) => setConv(data)).catch(() => {});
    } finally {
      setBusy(null);
    }
  };

  const Row = ({ icon: Icon, children }) => (
    <p className="flex items-center gap-3 text-[15px] text-[#1B1830]"><Icon className="h-5 w-5 shrink-0 text-[#7C6AE0]" />{children}</p>
  );

  return (
    <main className="grid min-h-screen place-items-center bg-[#F3F1FA] px-4 py-8">
      <div className="w-full max-w-sm space-y-5 rounded-3xl bg-white p-6 shadow-[0_10px_40px_rgba(23,20,46,0.08)]">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#7C6AE0]">Convocação de trabalho</p>
        {!conv && !error && <p className="flex items-center gap-2 text-sm text-[#5E5880]"><Loader2 className="h-4 w-4 animate-spin" />Carregando…</p>}
        {!conv && error && <p data-testid="conv-error" className="text-sm text-[#A12828]">{error}</p>}
        {conv && (
          <>
            <h1 className="text-2xl font-bold leading-tight text-[#17142E]">Olá, {conv.name}!</h1>
            <div className="space-y-3 rounded-2xl bg-[#FBFAFE] p-4">
              <Row icon={CalendarDays}><span className="first-letter:uppercase">{fmtDate(conv.date)}</span></Row>
              <Row icon={Clock}><b className="font-mono-data">{conv.start} às {conv.end}</b></Row>
              {conv.break_start && <Row icon={Coffee}>Intervalo {conv.break_start} às {conv.break_end}</Row>}
              <Row icon={MapPin}>Setor {conv.sector}</Row>
            </div>

            {conv.status === "pending" && (
              <>
                {conv.due && <p className="text-sm text-[#5E5880]">Responda até <b className="text-[#17142E]">{fmtDue(conv.due)}</b>. Sem resposta, a convocação conta como recusada.</p>}
                {error && <p className="text-sm text-[#A12828]">{error}</p>}
                <div className="grid grid-cols-2 gap-3">
                  <button data-testid="conv-decline" disabled={!!busy} onClick={() => answer("decline")}
                    className="flex h-14 items-center justify-center gap-2 rounded-2xl border-2 border-[#E4E0F3] text-base font-semibold text-[#4A4566] disabled:opacity-60">
                    {busy === "decline" ? <Loader2 className="h-5 w-5 animate-spin" /> : <X className="h-5 w-5" />}Recusar
                  </button>
                  <button data-testid="conv-accept" disabled={!!busy} onClick={() => answer("accept")}
                    className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-[#1F9D55] text-base font-semibold text-white disabled:opacity-60">
                    {busy === "accept" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}Aceitar
                  </button>
                </div>
              </>
            )}
            {conv.status === "accepted" && (
              <p data-testid="conv-result" className="rounded-2xl bg-[#E3F5EC] p-4 text-[15px] font-semibold text-[#1D6B45]">Convocação aceita. Seu horário já está na escala. Até lá!</p>
            )}
            {conv.status === "declined" && (
              <p data-testid="conv-result" className="rounded-2xl bg-[#F1F5F9] p-4 text-[15px] font-semibold text-[#475569]">
                {conv.expired ? "O prazo para responder terminou e a convocação foi considerada recusada." : "Convocação recusada. Obrigado por avisar."}
              </p>
            )}
            {conv.status !== "pending" && error && <p className="text-sm text-[#A12828]">{error}</p>}
          </>
        )}
      </div>
    </main>
  );
}
