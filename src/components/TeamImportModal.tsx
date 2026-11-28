import React, { useMemo, useState } from 'react';
import { Upload, Download, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { User, UserRole } from '../types';

interface TeamImportModalProps {
  isId: boolean;
  existingUsers: User[];
  defaultCategory: 'internal' | 'external';
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

interface ParsedImportRow {
  rowNum: number;
  username: string;
  name: string;
  email: string;
  employeeCode: string;
  phone: string;
  organizationName: string;
  userCategory: 'internal' | 'external';
  role: string;
  title: string;
  password: string;
  error?: string;
}

const VALID_ROLE_SET = new Set<string>([
  'Field / QC Inspector',
  'Action Owner / Subcontractor',
  'Project / Site Engineer',
  'QA/QC Lead / Owner Inspector',
  'Project Director & Tenant Admin',
  'Client / Vendor Viewer',
  'Field Inspector / Petugas K3',
  'Action Owner / Pelaksana Perbaikan',
  'Office / Integrity Engineer',
  'Authorized Inspector (API 510/570) & Verifikator K3',
  'HSE / Quality Manager & Tenant Admin',
]);

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      current += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export const TeamImportModal: React.FC<TeamImportModalProps> = ({
  isId,
  existingUsers,
  defaultCategory,
  onClose,
  onSuccess,
}) => {
  const [csvText, setCsvText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const existingUsernames = useMemo(
    () => new Set(existingUsers.map((u) => ((u as any).username || '').toLowerCase()).filter(Boolean)),
    [existingUsers]
  );
  const existingEmails = useMemo(
    () => new Set(existingUsers.map((u) => (u.email || '').toLowerCase()).filter(Boolean)),
    [existingUsers]
  );

  const previewRows = useMemo<ParsedImportRow[]>(() => {
    const lines = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return [];

    const firstCells = parseCsvLine(lines[0]).map((c) => c.toLowerCase());
    const hasHeader = firstCells.includes('username') || firstCells.includes('email');
    const dataLines = hasHeader ? lines.slice(1) : lines;

    const seenUsernames = new Set<string>();
    const seenEmails = new Set<string>();

    return dataLines.map((line, idx) => {
      const cols = parseCsvLine(line);
      const username = cols[0] || '';
      const name = cols[1] || '';
      const email = cols[2] || '';
      const employeeCode = cols[3] || '';
      const phone = cols[4] || '';
      const organizationName = cols[5] || '';
      const catRaw = (cols[6] || '').toLowerCase();
      const userCategory: 'internal' | 'external' =
        catRaw === 'external' || catRaw === 'internal' ? catRaw : defaultCategory;
      const role = cols[7] || (userCategory === 'external' ? 'Action Owner / Subcontractor' : 'Field / QC Inspector');
      const title = cols[8] || role;
      const password = cols[9] || '';

      let error: string | undefined;
      if (!username || !name || !email) {
        error = isId ? 'Username, nama, dan email wajib diisi' : 'Username, name, and email required';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        error = isId ? 'Format email tidak valid' : 'Invalid email format';
      } else if (!VALID_ROLE_SET.has(role)) {
        error = isId ? `Role tidak dikenal: ${role}` : `Unknown role: ${role}`;
      } else if (existingUsernames.has(username.toLowerCase()) || seenUsernames.has(username.toLowerCase())) {
        error = isId ? 'Username duplikat / sudah terdaftar' : 'Duplicate username';
      } else if (existingEmails.has(email.toLowerCase()) || seenEmails.has(email.toLowerCase())) {
        error = isId ? 'Email duplikat / sudah terdaftar' : 'Duplicate email';
      }

      if (username) seenUsernames.add(username.toLowerCase());
      if (email) seenEmails.add(email.toLowerCase());

      return {
        rowNum: idx + 1,
        username,
        name,
        email,
        employeeCode,
        phone,
        organizationName,
        userCategory,
        role: role as UserRole,
        title,
        password,
        error,
      };
    });
  }, [csvText, defaultCategory, existingEmails, existingUsernames, isId]);

  const validRows = previewRows.filter((r) => !r.error);
  const invalidRows = previewRows.filter((r) => Boolean(r.error));

  const handleDownloadTemplate = () => {
    const sample = [
      'username,name,email,employeeCode,phone,organizationName,userCategory,role,title,password',
      `andi.wijaya,Andi Wijaya,andi@perusahaan.co.id,EMP-014,081234567890,Divisi Konstruksi,internal,Field / QC Inspector,QC Inspector,SiteLens#2026`,
      `vendor.baja,PT Baja Mandiri,admin@bajamandiri.co.id,VND-008,081298765432,PT Baja Mandiri,external,Action Owner / Subcontractor,Subkontraktor Baja,SiteLens#2026`,
    ].join('\n');
    const blob = new Blob([sample], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sitelens_team_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ''));
    reader.readAsText(file);
  };

  const handleSubmit = async () => {
    if (validRows.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch('/api/users/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ rows: validRows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      onSuccess(
        isId
          ? `Import selesai: ${data.importedCount} berhasil, ${data.skippedCount} dilewati.`
          : `Import complete: ${data.importedCount} imported, ${data.skippedCount} skipped.`
      );
    } catch (err: any) {
      setSubmitError(err?.message || 'Gagal mengimpor data.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-slate-900 flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <h2 className="text-sm font-bold flex items-center space-x-2">
            <Upload className="w-4 h-4 text-slate-700" />
            <span>{isId ? 'Import Data Personil (CSV) + Live Preview' : 'Import Team CSV + Live Validation'}</span>
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs overflow-y-auto flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 font-semibold cursor-pointer inline-flex items-center space-x-1.5">
              <Upload className="w-3.5 h-3.5 text-slate-600" />
              <span>{isId ? 'Pilih File CSV' : 'Choose CSV File'}</span>
              <input type="file" accept=".csv,text/csv" onChange={handleFileChange} className="sr-only" />
            </label>

            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 font-semibold inline-flex items-center space-x-1.5"
            >
              <Download className="w-3.5 h-3.5 text-slate-600" />
              <span>{isId ? 'Unduh Template CSV' : 'Download CSV Template'}</span>
            </button>
          </div>

          <textarea
            rows={4}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={
              isId
                ? 'Atau tempel isi CSV di sini (username,name,email,employeeCode,phone,organizationName,userCategory,role,title,password)...'
                : 'Or paste CSV rows here...'
            }
            className="w-full p-2.5 border border-slate-300 rounded-lg font-mono text-[11px] bg-slate-50 focus:outline-none focus:border-slate-800"
          />

          {submitError && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800">{submitError}</div>
          )}

          {previewRows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800">
                  {isId ? 'Live Preview Validasi:' : 'Live Validation Preview:'}
                </span>
                <div className="flex items-center space-x-3 font-mono text-[11px]">
                  <span className="text-emerald-700 font-semibold">
                    {validRows.length} {isId ? 'Valid' : 'Valid'}
                  </span>
                  <span className="text-rose-600 font-semibold">
                    {invalidRows.length} {isId ? 'Error/Duplikat' : 'Invalid'}
                  </span>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-x-auto max-h-56">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                    <tr>
                      <th className="py-2 px-2.5">#</th>
                      <th className="py-2 px-2.5">Username / Nama</th>
                      <th className="py-2 px-2.5">NIK / Perusahaan</th>
                      <th className="py-2 px-2.5">Kategori &amp; Role</th>
                      <th className="py-2 px-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {previewRows.map((r) => (
                      <tr key={r.rowNum} className={r.error ? 'bg-rose-50/50' : ''}>
                        <td className="py-1.5 px-2.5 font-mono text-slate-400">{r.rowNum}</td>
                        <td className="py-1.5 px-2.5">
                          <div className="font-semibold text-slate-900">{r.name || '-'}</div>
                          <div className="text-slate-500 font-mono">{r.username} • {r.email}</div>
                        </td>
                        <td className="py-1.5 px-2.5">
                          <div className="font-mono text-slate-700">{r.employeeCode || '-'}</div>
                          <div className="text-slate-500">{r.organizationName || '-'}</div>
                        </td>
                        <td className="py-1.5 px-2.5">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-medium mr-1">
                            {r.userCategory}
                          </span>
                          <span>{r.role}</span>
                        </td>
                        <td className="py-1.5 px-2.5">
                          {r.error ? (
                            <span className="text-rose-700 inline-flex items-center space-x-1 font-medium">
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                              <span>{r.error}</span>
                            </span>
                          ) : (
                            <span className="text-emerald-700 inline-flex items-center space-x-1 font-medium">
                              <CheckCircle2 className="w-3 h-3 shrink-0" />
                              <span>OK</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end space-x-2 text-xs">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 font-semibold">
            {isId ? 'Batal' : 'Cancel'}
          </button>
          <button
            type="button"
            disabled={submitting || validRows.length === 0}
            onClick={handleSubmit}
            className="px-4 py-1.5 rounded-lg bg-[#d4f038] hover:bg-[#c4e820] text-[#0b0e14] font-bold disabled:opacity-40"
          >
            {submitting
              ? '...'
              : isId
              ? `Import ${validRows.length} Baris Valid`
              : `Import ${validRows.length} Valid Rows`}
          </button>
        </div>
      </div>
    </div>
  );
};
