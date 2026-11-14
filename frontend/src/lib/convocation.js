// Contrato intermitente (CLT art. 452-A): trabalha só nos dias em que aceitou a convocação

export const isIntermittent = (emp) =>
  emp?.contract ? emp.contract === "intermitente" : /intermitente/i.test(emp?.role || "");

// Estado da convocação no dia: undefined | "pending" | "accepted" | "declined"
export const convocationOf = (schedule, empId, day) => schedule?.convocations?.[empId]?.[String(day)];

export const acceptedOn = (schedule, empId, day) => convocationOf(schedule, empId, day)?.status === "accepted";

export const CONVOCATION_LABEL = { pending: "CONVOCADO", accepted: "ACEITO", declined: "RECUSOU" };

// A convocação precisa ser feita com pelo menos 3 dias corridos de antecedência
export const MIN_NOTICE_DAYS = 3;
export const shortNotice = (conv, date) => {
  if (!conv?.at || conv.status === "declined") return false;
  const [y, m, d] = conv.at.split("-").map(Number);
  const sent = new Date(y, m - 1, d);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return (target - sent) / 86400000 < MIN_NOTICE_DAYS;
};
