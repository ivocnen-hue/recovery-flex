type RuleCondition = { field: string; op: string; value?: unknown; min?: unknown; max?: unknown };

const fieldLabels: Record<string, string> = {
  quantity: "Quantidade de unidades",
  weight_g: "Peso",
  max_dimension_cm: "Maior dimensão",
  height_cm: "Altura",
  width_cm: "Largura",
  length_cm: "Comprimento",
  volume_cm3: "Volume",
  sku: "SKU",
  date: "Data",
};
const operatorLabels: Record<string, string> = {
  lt: "menor que",
  lte: "menor ou igual a",
  gt: "maior que",
  gte: "maior ou igual a",
  eq: "igual a",
  neq: "diferente de",
  in: "contido em",
  between: "entre",
};

const displayValue = (field: string, value: unknown) => {
  if (typeof value !== "number") return String(value ?? "não informado");
  if (field === "weight_g") return value >= 1000 ? `${(value / 1000).toLocaleString("pt-BR")} kg` : `${value.toLocaleString("pt-BR")} g`;
  if (["max_dimension_cm", "height_cm", "width_cm", "length_cm"].includes(field)) return `${value.toLocaleString("pt-BR")} cm`;
  if (field === "volume_cm3") return `${value.toLocaleString("pt-BR")} cm³`;
  return value.toLocaleString("pt-BR");
};

export function formatRuleCondition(condition: RuleCondition) {
  const field = fieldLabels[condition.field] ?? condition.field;
  if (condition.op === "between") return `${field} entre ${displayValue(condition.field, condition.min)} e ${displayValue(condition.field, condition.max)}`;
  return `${field} ${operatorLabels[condition.op] ?? condition.op} ${displayValue(condition.field, condition.value)}`;
}
