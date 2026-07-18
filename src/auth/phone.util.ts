/** 规范化手机号：去空格、去 +86/86 前缀 */
export function normalizePhone(raw: string): string {
  let p = raw.trim().replace(/[\s-]/g, '');
  if (p.startsWith('+86')) p = p.slice(3);
  else if (p.startsWith('86') && p.length === 13) p = p.slice(2);
  return p;
}
