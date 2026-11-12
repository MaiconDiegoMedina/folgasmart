// Leitura de arquivos CSV exportados por sistemas (Excel/ERP), em UTF-8 ou ANSI

export const readText = async (file) => {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
};

const splitLine = (line, sep) => {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === sep && !quoted) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
};

// Retorna { header: [...], rows: [[...], ...] } com o separador detectado pelo cabeçalho
export const parseCsv = (text) => {
  const lines = String(text).replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { header: [], rows: [] };
  const sep = [";", "\t", ","].reduce((best, s) => (splitLine(lines[0], s).length > splitLine(lines[0], best).length ? s : best), ";");
  const header = splitLine(lines[0], sep);
  const rows = lines.slice(1).map((l) => splitLine(l, sep)).filter((r) => r.some((c) => c));
  return { header, rows };
};

const normalize = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Acha a coluna cujo cabeçalho contém uma das palavras
export const guessColumn = (header, words) => header.findIndex((h) => words.some((w) => normalize(h).includes(w)));

export const parseGender = (raw) => {
  const v = normalize(raw);
  if (["m", "masc", "masculino", "h", "homem"].includes(v)) return "M";
  if (["f", "fem", "feminino", "mulher"].includes(v)) return "F";
  return null;
};

export const sameText = (a, b) => normalize(a) === normalize(b);
