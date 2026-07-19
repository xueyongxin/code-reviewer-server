/** 统一日期时间展示：YYYY-MM-DD HH:mm:ss（本地时区） */

const pad2 = (n: number): string => String(n).padStart(2, '0')

const toValidDate = (value?: string | number | Date | null): Date | null => {
  if (value == null || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** YYYY-MM-DD HH:mm:ss */
export const formatDateTime = (
  value?: string | number | Date | null,
  fallback = ''
): string => {
  const d = toValidDate(value)
  if (!d) return fallback
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

/** YYYY-MM-DD */
export const formatDate = (
  value?: string | number | Date | null,
  fallback = ''
): string => {
  const d = toValidDate(value)
  if (!d) return fallback
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
