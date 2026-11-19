// Agrupa funcionários por cargo; cada grupo ordenado por "order"
const byName = (a, b) => a.name.localeCompare(b.name, "pt-BR");

// Frente de Caixa: Op. Caixa, Teste, Pacoteiro, Fiscal e Recepcionista; outros cargos depois, em ordem alfabética
const FRONT_ROLES = [/caixa/i, /teste/i, /pacot/i, /fiscal/i, /recep/i];
const frontRank = (role) => {
  if (/fiscal/i.test(role)) return 3; // "Fiscal de Caixa" é fiscal, não operadora
  const i = FRONT_ROLES.findIndex((re) => re.test(role));
  return i < 0 ? FRONT_ROLES.length : i;
};

export const groupByRole = (members, order = byName, sector = "") => {
  const groups = {};
  for (const emp of members) (groups[emp.role || "Sem cargo"] ||= []).push(emp);
  const rank = /caixa/i.test(sector) ? frontRank : () => 0;
  return Object.keys(groups)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "pt-BR"))
    .map((role) => ({ role, members: groups[role].sort(order) }));
};
