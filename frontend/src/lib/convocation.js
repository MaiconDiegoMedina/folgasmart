// Contrato intermitente (CLT art. 452-A): trabalha só nos dias em que aceitou a convocação

export const isIntermittent = (emp) =>
  emp?.contract ? emp.contract === "intermitente" : /intermitente/i.test(emp?.role || "");

// Estado da convocação no dia: undefined | "pending" | "accepted" | "declined"
export const convocationOf = (schedule, empId, day) => schedule?.convocations?.[empId]?.[String(day)];

export const acceptedOn = (schedule, empId, day) => convocationOf(schedule, empId, day)?.status === "accepted";

export const CONVOCATION_LABEL = { pending: "CONVOCADO", accepted: "ACEITO", declined: "RECUSOU" };
export const convocationLabel = (conv) => (conv?.expired ? "SEM RESPOSTA" : CONVOCATION_LABEL[conv?.status]);

// A convocação precisa ser feita com pelo menos 3 dias corridos de antecedência
export const MIN_NOTICE_DAYS = 3;
export const shortNotice = (conv, date) => {
  if (!conv?.at || conv.status === "declined") return false;
  const [y, m, d] = conv.at.split("-").map(Number);
  const sent = new Date(y, m - 1, d);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return (target - sent) / 86400000 < MIN_NOTICE_DAYS;
};

// Intervalo da CLT (art. 71): acima de 4h até 6h trabalhadas, 15 min; acima de 6h, de 1h a 2h.
// Mesma regra do servidor. Recebe entrada, saída e intervalo ("HH:MM" ou vazio) e devolve o erro ou null.
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
// CCT SINDECAM cl. 30: o lanche de 15 min conta como tempo de serviço (intervalo de 1h ou mais não conta)
const LANCHE = 15;
const workedOf = (span, brk) => span - brk + (brk < 60 ? Math.min(brk, LANCHE) : 0);

// Saída máxima pela CCT (cl. 28): fecha ao público às 22h (domingo 18h; 24 e 31/12 19h) + 1h de trabalho interno.
// Feriado com a hora de fechamento informada: essa hora + 1h.
export const closingOf = (date, holiday) => {
  if (holiday?.close_time) {
    const h = Number(holiday.close_time.slice(0, 2)) + 1;
    return h > 23 ? "23:59" : `${String(h).padStart(2, "0")}:${holiday.close_time.slice(3)}`;
  }
  if (date.getMonth() === 11 && [24, 31].includes(date.getDate())) return "20:00";
  if (date.getDay() === 0 && !holiday) return "19:00";
  return "23:00";
};

// prevEnd / nextStart: saída da convocação do dia anterior e entrada do dia seguinte (descanso de 11h, CLT art. 66)
export const convocationSummary = ({ start, end, breakStart, breakEnd }, { prevEnd, nextStart, closing } = {}) => {
  if (!start || !end) return { error: "Informe a entrada e a saída." };
  if (toMin(end) <= toMin(start)) return { error: "A saída precisa ser depois da entrada." };
  if (!!breakStart !== !!breakEnd) return { error: "Informe a saída e a volta do intervalo." };
  let brk = 0;
  if (breakStart) {
    if (!(toMin(start) < toMin(breakStart) && toMin(breakStart) < toMin(breakEnd) && toMin(breakEnd) < toMin(end)))
      return { error: "O intervalo precisa ficar dentro do horário, depois da entrada e antes da saída." };
    brk = toMin(breakEnd) - toMin(breakStart);
  }
  const worked = workedOf(toMin(end) - toMin(start), brk);
  let error = null;
  const rest = (a, b) => toMin(b) + 1440 - toMin(a);
  const fmtRest = (m) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
  if (closing && end > closing) error = `Saída depois das ${closing}: pela CCT (cl. 28) a loja fecha ao público e o trabalho interno vai no máximo 1h depois.`;
  else if (worked > 600) error = "Máximo de 10h trabalhadas no dia (8h normais + 2h extras, CLT art. 59).";
  else if (prevEnd && rest(prevEnd, start) < 660) error = `Descanso de só ${fmtRest(rest(prevEnd, start))} desde a saída do dia anterior (${prevEnd}). O mínimo é de 11h (CLT art. 66).`;
  else if (nextStart && rest(end, nextStart) < 660) error = `Descanso de só ${fmtRest(rest(end, nextStart))} até a entrada do dia seguinte (${nextStart}). O mínimo é de 11h (CLT art. 66).`;
  else if (worked > 360 && !(brk >= 60 && brk <= 120)) error = `Para mais de 6h trabalhadas, o intervalo precisa ter de 1h a 2h.${brk > 0 && brk < 60 ? " O lanche de 15 min conta como trabalho (CCT cl. 30)." : ""}`;
  else if (worked > 240 && worked <= 360 && brk < 15) error = "Para mais de 4h até 6h trabalhadas, o intervalo mínimo é de 15 minutos.";
  const rule = worked > 360 ? "mais de 6h: intervalo de 1h a 2h" : worked > 240 ? "de 4h a 6h: intervalo mínimo de 15 min" : "até 4h: intervalo não obrigatório";
  // Passou de 8h: o que vier depois já é hora extra (o adicional da CCT pode ser maior que os 50% da lei)
  const overtime = worked > 480 ? worked - 480 : 0;
  return { worked, brk, error, rule, overtime };
};

export const fmtDuration = (m) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;

// Link que o intermitente abre para aceitar ou recusar (não precisa de login)
export const convocationLink = (token) => `${window.location.origin}/?convocacao=${encodeURIComponent(token)}`;

const fmtDue = (iso) => {
  const d = new Date(iso);
  const day = d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }).replace(".", "");
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  return `${day} às ${time}`;
};
export { fmtDue };

// WhatsApp com a mensagem pronta. Sem celular cadastrado, o WhatsApp pede para escolher o contato.
export const whatsappUrl = (emp, conv, date) => {
  const first = emp.name.split(" ")[0];
  const day = date.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
  const pause = conv.break_start ? ` (intervalo ${conv.break_start} às ${conv.break_end})` : "";
  const text = [
    `Olá, ${first}! Você está sendo convocado(a) para trabalhar:`,
    ``,
    `Dia: ${day}`,
    `Horário: ${conv.start} às ${conv.end}${pause}`,
    `Setor: ${emp.sector}`,
    ``,
    `Para aceitar ou recusar, abra o link até ${fmtDue(conv.due)}:`,
    convocationLink(conv.token),
    ``,
    `Sem resposta no prazo, a convocação é considerada recusada (CLT, art. 452-A).`,
  ].join("\n");
  const phone = (emp.phone || "").replace(/\D/g, "");
  return `https://wa.me/${phone ? `55${phone}` : ""}?text=${encodeURIComponent(text)}`;
};
