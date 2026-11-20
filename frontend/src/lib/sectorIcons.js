import {
  Apple, Baby, Barcode, Beef, Book, Boxes, Briefcase, Cake, Candy, Car, Carrot, ClipboardList, Coffee, Cookie,
  CreditCard, Croissant, Dog, Drumstick, Egg, Fish, Flower2, Gift, Hammer, Headphones, IceCreamCone, Laptop,
  LayoutGrid, Leaf, Milk, Package, PackageOpen, Pill, Pizza, Sandwich, Scale, Shirt, ShieldCheck, ShoppingBasket,
  Snowflake, Soup, Sparkles, SprayCan, Store, Tag, Truck, Users, UtensilsCrossed, Warehouse, Wine, Wrench,
} from "lucide-react";

// Ícones que o administrador pode escolher para um setor (Configurações › Setores)
export const SECTOR_ICONS = {
  Beef, Drumstick, Fish, Croissant, Cake, Cookie, Apple, Carrot, Leaf, Milk, Egg, Snowflake, IceCreamCone, Wine,
  Coffee, Sandwich, Pizza, Soup, UtensilsCrossed, Candy, ShoppingBasket, Store, PackageOpen, Package, Boxes,
  Warehouse, Truck, Barcode, Scale, Tag, CreditCard, Briefcase, ClipboardList, Users, Headphones, ShieldCheck,
  Wrench, Hammer, SprayCan, Sparkles, Pill, Baby, Dog, Shirt, Flower2, Gift, Book, Laptop, Car, LayoutGrid,
};

// Ícone sugerido pelo nome do setor, quando o administrador não escolheu um
const BY_NAME = [
  [/a[çc]oug|carne/i, "Beef"], [/peix/i, "Fish"], [/frango|avic/i, "Drumstick"], [/confeit|doce/i, "Cake"],
  [/padaria|panific/i, "Croissant"], [/horti|flv|frut|verdur|legum/i, "Apple"], [/frios|latic/i, "Milk"],
  [/congel/i, "Snowflake"], [/bebida|adega/i, "Wine"], [/caf[eé]|lanch/i, "Coffee"], [/rotis|cozinha|restaur/i, "UtensilsCrossed"],
  [/mercearia/i, "ShoppingBasket"], [/reposi|repositor/i, "PackageOpen"], [/dep[oó]sito|estoque|almox/i, "Warehouse"],
  [/receb|log[ií]st|expedi/i, "Truck"], [/credi[aá]rio|cr[eé]dito|cobran/i, "CreditCard"], [/limpeza|higien/i, "SprayCan"],
  [/perfum|beleza/i, "Sparkles"], [/farm[aá]c|drog/i, "Pill"], [/seguran|preven/i, "ShieldCheck"], [/manuten/i, "Wrench"],
  [/administ|escrit|financ|rh\b|recursos/i, "Briefcase"], [/atendim|sac\b|telev/i, "Headphones"], [/pet/i, "Dog"],
  [/bazar|t[eê]xtil|confec/i, "Shirt"], [/flor/i, "Flower2"], [/fiscal|recep/i, "ClipboardList"], [/geral|loja/i, "Store"],
];

export const iconNameFor = (sector) => {
  if (sector?.icon && SECTOR_ICONS[sector.icon]) return sector.icon;
  const name = sector?.name || "";
  return BY_NAME.find(([re]) => re.test(name))?.[1] || "LayoutGrid";
};
export const iconFor = (sector) => SECTOR_ICONS[iconNameFor(sector)];

// "Quem está no açougue" / "na padaria" / "no setor Geral"
const ARTICLES = [
  [/^a[çc]ougue$/i, "no"], [/^padaria$/i, "na"], [/^reposi[çc][ãa]o$/i, "na"], [/^hortifr[uú]ti$/i, "no"],
  [/^dep[oó]sito$/i, "no"], [/^credi[aá]rio$/i, "no"], [/^peixaria$/i, "na"], [/^confeitaria$/i, "na"],
  [/^mercearia$/i, "na"], [/^rotisseria$/i, "na"], [/^limpeza$/i, "na"], [/^perfumaria$/i, "na"], [/^adega$/i, "na"],
];
const titleOf = (name) => {
  const article = ARTICLES.find(([re]) => re.test(name.trim()))?.[1];
  return article ? [article, name.toLowerCase()] : ["no setor", name];
};

// O quadro de caixas tem aba própria (Caixas)
export const isCaixaSector = (name) => /caixa/i.test(name || "");

// Uma aba por setor cadastrado (menos os de caixa)
export const sectorTabsOf = (sectors = []) =>
  sectors
    .filter((s) => !isCaixaSector(s.name))
    .map((s) => {
      const key = s.name.trim().toLowerCase();
      return {
        id: `setor:${key}`,
        label: s.name,
        short: s.name.length > 9 ? `${s.name.slice(0, 8)}.` : s.name,
        icon: iconFor(s),
        hint: s.name,
        title: titleOf(s.name),
        employees: s.employees || 0,
        match: { test: (sector) => (sector || "").trim().toLowerCase() === key },
      };
    });

// Setores mais abertos ficam primeiro na barra lateral (contagem guardada só neste navegador)
const USE_KEY = "escalasmart.sectorUse";
const readUse = () => {
  try {
    return JSON.parse(localStorage.getItem(USE_KEY) || "{}") || {};
  } catch {
    return {};
  }
};
export const countSectorUse = (id) => {
  try {
    const use = readUse();
    use[id] = (use[id] || 0) + 1;
    localStorage.setItem(USE_KEY, JSON.stringify(use));
  } catch { /* sem armazenamento: só não reordena */ }
};
export const byUse = (tabs) => {
  const use = readUse();
  return [...tabs].sort((a, b) => (use[b.id] || 0) - (use[a.id] || 0) || b.employees - a.employees || a.label.localeCompare(b.label, "pt-BR"));
};
