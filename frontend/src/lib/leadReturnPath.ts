// Only allow returns to CRM list screens, never an external URL.
export function leadReturnPath(value: string | null): string {
  if (!value || /[\\\r\n]/.test(value)) return '/leads';
  const path = value.split('?')[0];
  const distribution = /^\/leads\/distribution(?:\/rm\/[0-9a-f-]{36}(?:\/leads|\/counselor\/[0-9a-f-]{36})?)?$/i.test(path);
  return path === '/leads' || path === '/dashboard/member' || distribution ? value : '/leads';
}
