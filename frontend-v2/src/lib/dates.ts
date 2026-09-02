export const formatIsoDay = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
};

export const formatPeriod = (value: string) =>
  value.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_date, year, month, day) => `${day}-${month}-${year}`);

export const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatPeriod(value);
  const parts = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}-${part("month")}-${part("year")} ${part("hour")}:${part("minute")}`;
};
