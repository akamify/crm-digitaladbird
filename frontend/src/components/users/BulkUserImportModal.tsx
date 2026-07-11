'use client';

import { ChangeEvent, useMemo, useState } from 'react';
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { useBulkImportUsers, type BulkUserImportResult, type BulkUserImportRow } from '@/hooks/useUsers';

type ImportRole = 'rm' | 'member';
type ImportField = 'full_name' | 'email' | 'phone' | 'reporting_rm' | 'team_name';
type CsvData = { headers: string[]; rows: string[][] };

const LABELS: Record<ImportField, string> = {
  full_name: 'Full Name',
  email: 'Email',
  phone: 'Phone',
  reporting_rm: 'Reporting RM',
  team_name: 'Team Name',
};

const ALIASES: Record<ImportField, string[]> = {
  full_name: ['full_name', 'name', 'member_name', 'rm_name'],
  email: ['email', 'email_address'],
  phone: ['phone', 'mobile', 'mobile_number', 'phone_number'],
  reporting_rm: ['reporting_rm', 'reporting_manager', 'rm', 'rm_email', 'rm_cp_id'],
  team_name: ['team_name', 'team'],
};

function fieldsForRole(role: ImportRole): ImportField[] {
  return role === 'rm'
    ? ['full_name', 'email', 'phone', 'team_name']
    : ['full_name', 'email', 'phone', 'reporting_rm'];
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function parseCsv(text: string): CsvData {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === ',' && !quoted) { row.push(cell.trim()); cell = ''; continue; }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = []; cell = ''; continue;
    }
    cell += char;
  }
  row.push(cell.trim());
  if (row.some(value => value !== '')) rows.push(row);
  if (rows.length < 2) throw new Error('CSV must include a header row and at least one user row.');
  const [headers, ...dataRows] = rows;
  if (headers.some(header => !header)) throw new Error('CSV headers cannot be blank.');
  const normalizedHeaders = headers.map(normalizeHeader);
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    throw new Error('CSV contains duplicate column headers. Rename duplicate headers and upload again.');
  }
  return { headers, rows: dataRows };
}

function suggestedMapping(headers: string[]): Record<ImportField, string> {
  const normalized = new Map(headers.map(header => [normalizeHeader(header), header]));
  return (Object.keys(LABELS) as ImportField[]).reduce((mapping, field) => {
    const found = ALIASES[field].map(alias => normalized.get(alias)).find(Boolean);
    mapping[field] = found || '';
    return mapping;
  }, {} as Record<ImportField, string>);
}

export function BulkUserImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [role, setRole] = useState<ImportRole>('member');
  const [csv, setCsv] = useState<CsvData | null>(null);
  const [mapping, setMapping] = useState<Record<ImportField, string>>(() => suggestedMapping([]));
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(true);
  const [result, setResult] = useState<BulkUserImportResult | null>(null);
  const importer = useBulkImportUsers();
  const requiredFields = fieldsForRole(role);

  const mappedRows = useMemo<BulkUserImportRow[]>(() => {
    if (!csv) return [];
    const indexes = new Map(csv.headers.map((header, index) => [header, index]));
    return csv.rows.map((row, index) => {
      const value = (field: ImportField) => mapping[field]
        ? row[indexes.get(mapping[field]) ?? -1] || ''
        : '';
      return {
        row_number: index + 2,
        full_name: value('full_name'),
        email: value('email'),
        phone: value('phone'),
        role,
        reporting_rm: role === 'member' ? value('reporting_rm') : undefined,
        team_name: role === 'rm' ? value('team_name') : undefined,
      };
    });
  }, [csv, mapping, role]);

  function reset() {
    setCsv(null);
    setMapping(suggestedMapping([]));
    setResult(null);
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) { toast.error('Upload a CSV file.'); return; }
    try {
      const parsed = parseCsv(await file.text());
      setCsv(parsed);
      setMapping(suggestedMapping(parsed.headers));
      setResult(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not read CSV.');
    }
  }

  function changeRole(nextRole: ImportRole) {
    setRole(nextRole);
    setMapping(suggestedMapping(csv?.headers || []));
    setResult(null);
  }

  function submit() {
    if (!csv) { toast.error('Choose a CSV file first.'); return; }
    const missing = requiredFields.filter(field => !mapping[field]);
    if (missing.length) { toast.error(`Map required columns: ${missing.map(field => LABELS[field]).join(', ')}`); return; }
    const mappedColumns = requiredFields.map(field => mapping[field]);
    if (new Set(mappedColumns).size !== mappedColumns.length) {
      toast.error('Map each required field to a different CSV column.');
      return;
    }
    importer.mutate({ role, rows: mappedRows, sendWelcomeEmail }, {
      onSuccess: (data) => {
        setResult(data);
        if (data.created) toast.success(`${data.created} user${data.created === 1 ? '' : 's'} created`);
        if (data.failed) toast.error(`${data.failed} row${data.failed === 1 ? '' : 's'} failed. Review the import results and Activity Logs.`);
      },
      onError: (error: unknown) => {
        const message = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
        toast.error(message || 'Bulk import failed.');
      },
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Import Users from CSV" description="Import one user type at a time. Invalid rows are skipped and logged; valid rows continue." size="xl">
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">Import Type</span>
            <select value={role} onChange={event => changeRole(event.target.value as ImportRole)} disabled={importer.isPending} className="input w-full">
              <option value="member">Members</option>
              <option value="rm">RMs</option>
            </select>
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
            <input type="checkbox" checked={sendWelcomeEmail} onChange={event => setSendWelcomeEmail(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Send onboarding email with password setup link
          </label>
        </div>

        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50">
            <Upload className="h-4 w-4" /> Choose CSV file
            <input type="file" accept=".csv,text/csv" onChange={onFileChange} className="sr-only" />
          </label>
          <p className="mt-2 text-xs text-slate-500">
            {role === 'member'
              ? 'Required: Name, Email, Phone, Reporting RM (active RM email, user ID, or CP ID). Role comes from Import Type above.'
              : 'Required: Name, Email, Phone, Team Name. Role comes from Import Type above.'}
          </p>
        </div>

        {csv && !result && (
          <>
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="mb-3 flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-brand-600" /><h3 className="text-sm font-semibold text-slate-900">Map CSV columns</h3><span className="text-xs text-slate-500">{csv.rows.length} rows</span></div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {requiredFields.map(field => (
                  <label key={field} className="block"><span className="label">{LABELS[field]} *</span>
                    <select value={mapping[field]} onChange={event => setMapping(current => ({ ...current, [field]: event.target.value }))} className="input w-full">
                      <option value="">Select CSV column</option>
                      {csv.headers.map(header => <option key={header} value={header}>{header}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <div className="max-h-[60dvh] overflow-auto">
                <table className="w-full min-w-max text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-left text-slate-500"><tr><th className="whitespace-nowrap px-3 py-2 font-medium">Row</th>{csv.headers.map(header => <th key={header} className="whitespace-nowrap px-3 py-2 font-medium">{header}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">{csv.rows.map((row, index) => <tr key={index}><td className="whitespace-nowrap px-3 py-2 text-slate-400">{index + 2}</td>{csv.headers.map((header, columnIndex) => <td key={header} className="whitespace-nowrap px-3 py-2 text-slate-700">{row[columnIndex] || '—'}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {result && (
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"><strong>{result.created}</strong> created, <strong>{result.failed}</strong> failed out of {result.requested}. Each result is recorded in Admin Activity Logs.</div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200"><table className="w-full text-xs"><thead className="sticky top-0 bg-slate-50 text-left text-slate-500"><tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">User</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Reason</th></tr></thead><tbody className="divide-y divide-slate-100">{result.results.map(item => <tr key={item.row_number}><td className="px-3 py-2">{item.row_number}</td><td className="px-3 py-2">{item.user?.full_name || item.input?.full_name || '—'}</td><td className="px-3 py-2"><span className={item.status === 'created' ? 'text-emerald-700' : 'text-rose-700'}>{item.status}</span></td><td className="px-3 py-2 text-slate-600">{item.reason || item.emailWarning || 'Created successfully'}</td></tr>)}</tbody></table></div>
          </div>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        {csv && !importer.isPending && <button type="button" onClick={reset} className="btn-ghost rounded-lg px-4 py-2 text-sm">Reset</button>}
        <button type="button" onClick={onClose} disabled={importer.isPending} className="btn-outline rounded-lg px-4 py-2 text-sm">Close</button>
        {!result && <button type="button" onClick={submit} disabled={!csv || importer.isPending} className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm disabled:opacity-50">{importer.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Import Users</button>}
      </div>
    </Modal>
  );
}
