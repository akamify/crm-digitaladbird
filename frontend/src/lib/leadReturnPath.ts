// Only allow returns to CRM list screens, never an external URL.
export function leadReturnPath(value: string | null): string {
  if (!value || /[\\\r\n]/.test(value)) return '/leads';
  const path = value.split('?')[0];
  return path === '/leads' || path === '/dashboard/member' ? value : '/leads';
}
