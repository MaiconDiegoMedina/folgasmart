// Agrupa funcionários por cargo (cargos em ordem alfabética); cada grupo ordenado por "order"
const byName = (a, b) => a.name.localeCompare(b.name, "pt-BR");

export const groupByRole = (members, order = byName) => {
  const groups = {};
  for (const emp of members) (groups[emp.role || "Sem cargo"] ||= []).push(emp);
  return Object.keys(groups)
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map((role) => ({ role, members: groups[role].sort(order) }));
};
