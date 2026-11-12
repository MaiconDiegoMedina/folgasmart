import { useRef, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { http, errMsg } from "@/lib/api";
import { readText, parseCsv, guessColumn, parseGender, sameText } from "@/lib/csvFile";

const FIELDS = [
  { key: "name", label: "Nome", words: ["nome", "funcionario", "colaborador", "empregado"], required: true },
  { key: "role", label: "Cargo", words: ["cargo", "funcao"] },
  { key: "sector", label: "Setor", words: ["setor", "departamento", "depto", "secao", "centro de custo"] },
  { key: "gender", label: "Sexo", words: ["sexo", "genero"] },
  { key: "workload", label: "Jornada", words: ["jornada", "horario", "escala"] },
];

const selectCls = "w-full rounded-md border border-[#E5E1D8] bg-white px-2 py-1 text-xs";

export const ImportEmployees = ({ workloads, onDone }) => {
  const fileRef = useRef(null);
  const [data, setData] = useState(null); // { header, rows, map, defaults }
  const [busy, setBusy] = useState(false);

  const onFile = async (file) => {
    if (!file) return;
    try {
      const { header, rows } = parseCsv(await readText(file));
      if (!header.length || !rows.length) return toast.error("Arquivo vazio. Exporte a lista do cartão ponto em CSV.");
      const map = Object.fromEntries(FIELDS.map((f) => [f.key, guessColumn(header, f.words)]));
      if (map.name < 0) map.name = 0;
      setData({ header, rows, map, defaults: { role: "A definir", sector: "A definir" } });
    } catch {
      toast.error("Não foi possível ler o arquivo. Salve a planilha como CSV e tente de novo.");
    } finally {
      fileRef.current.value = "";
    }
  };

  const build = () => {
    const { rows, map, defaults } = data;
    const cell = (row, key) => (map[key] >= 0 ? (row[map[key]] || "").trim() : "");
    return rows
      .map((row) => {
        const wl = cell(row, "workload");
        const workload = wl ? workloads.find((w) => sameText(w.name, wl) || w.id === wl)?.id || null : null;
        return {
          name: cell(row, "name"),
          role: cell(row, "role") || defaults.role.trim() || "A definir",
          sector: cell(row, "sector") || defaults.sector.trim() || "A definir",
          status: "ativo",
          gender: parseGender(cell(row, "gender")),
          workload,
        };
      })
      .filter((e) => e.name);
  };

  const submit = async () => {
    const employees = build();
    if (!employees.length) return toast.error("Nenhum funcionário com nome na coluna escolhida.");
    setBusy(true);
    try {
      const { data: r } = await http.post("/employees/import", { employees });
      toast.success(`${r.created} funcionário(s) importado(s)${r.skipped ? `, ${r.skipped} já cadastrado(s) ignorado(s)` : ""}`);
      setData(null);
      onDone();
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const preview = data ? build() : [];

  return (
    <>
      <Button data-testid="btn-import-employees" size="sm" variant="outline" onClick={() => fileRef.current.click()} className="rounded-full">
        <FileUp className="h-4 w-4 mr-1" /> Importar do cartão ponto
      </Button>
      <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" className="hidden" onChange={(e) => onFile(e.target.files[0])} />

      {data && (
        <div data-testid="import-employees-preview" className="basis-full mt-3 rounded-xl border border-[#E5E1D8] bg-[#F9F8F5] p-4 space-y-3">
          <p className="text-sm font-bold">Arquivo com {data.rows.length} linha(s). Indique de qual coluna vem cada informação:</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {FIELDS.map((f) => (
              <label key={f.key} className="text-[11px] font-semibold text-[#575E65] space-y-1">
                <span>{f.label}{f.required && " *"}</span>
                <select
                  value={data.map[f.key]}
                  onChange={(e) => setData({ ...data, map: { ...data.map, [f.key]: Number(e.target.value) } })}
                  className={selectCls}
                >
                  {!f.required && <option value={-1}>— não importar —</option>}
                  {data.header.map((h, i) => <option key={i} value={i}>{h || `Coluna ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          {(data.map.role < 0 || data.map.sector < 0) && (
            <div className="grid grid-cols-2 gap-2">
              {["role", "sector"].filter((k) => data.map[k] < 0).map((k) => (
                <label key={k} className="text-[11px] font-semibold text-[#575E65] space-y-1">
                  <span>{k === "role" ? "Cargo" : "Setor"} para todos</span>
                  <input
                    value={data.defaults[k]}
                    onChange={(e) => setData({ ...data, defaults: { ...data.defaults, [k]: e.target.value } })}
                    className={selectCls}
                  />
                </label>
              ))}
            </div>
          )}
          <div className="text-xs text-[#575E65]">
            <p className="font-semibold mb-1">Prévia:</p>
            <ul className="space-y-0.5">
              {preview.slice(0, 5).map((e, i) => (
                <li key={i}>
                  <b>{e.name}</b> · {e.role} · {e.sector} · {e.gender === "M" ? "Masc." : e.gender === "F" ? "Fem." : "sexo ?"} ·{" "}
                  {workloads.find((w) => w.id === e.workload)?.name || "jornada ?"}
                </li>
              ))}
              {preview.length > 5 && <li>… e mais {preview.length - 5}</li>}
            </ul>
            <p className="mt-2">Quem já está cadastrado com o mesmo nome é ignorado. Sexo e jornada que não forem reconhecidos podem ser ajustados depois na lista.</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setData(null)}>Cancelar</Button>
            <Button size="sm" disabled={busy || !preview.length} onClick={submit} className="bg-[#0F172A] hover:bg-[#1E293B] text-white">
              {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Importar {preview.length} funcionário(s)
            </Button>
          </div>
        </div>
      )}
    </>
  );
};
