export const formatConfidence = (value: number | null) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("pt-BR", {
        style: "percent",
        maximumFractionDigits: 0,
      }).format(value);
