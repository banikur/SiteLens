import React, { useMemo, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Flag, FolderTree } from 'lucide-react';
import type { NationalHoliday, Project } from '../types';

export interface CalendarAgendaItem {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  subtitle: string;
  kind: 'milestone' | 'start' | 'deadline' | 'project_period';
  site?: Project;
}

interface ProjectMiniCalendarProps {
  agendas: CalendarAgendaItem[];
  holidays?: NationalHoliday[];
  onOpenSiteWbs?: (site: Project) => void;
}

const DAY_NAMES = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const ProjectMiniCalendar: React.FC<ProjectMiniCalendarProps> = ({
  agendas,
  holidays = [],
  onOpenSiteWbs,
}) => {
  const today = new Date();
  const todayKey = toDateKey(today);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(todayKey);

  const agendaByDate = useMemo(() => {
    const map = new Map<string, CalendarAgendaItem[]>();
    for (const item of agendas) {
      const list = map.get(item.date) || [];
      list.push(item);
      map.set(item.date, list);
    }
    return map;
  }, [agendas]);

  const holidayByDate = useMemo(() => {
    const map = new Map<string, NationalHoliday>();
    for (const h of holidays) map.set(h.holidayDate, h);
    return map;
  }, [holidays]);

  const calendarCells = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const startOffset = (firstDay.getDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: Array<{ dateKey: string; day: number } | null> = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ dateKey: key, day: d });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const selectedAgendas = agendaByDate.get(selectedDate) || [];
  const selectedHoliday = holidayByDate.get(selectedDate);
  const upcomingAgendas = useMemo(
    () =>
      agendas
        .filter((a) => a.date >= todayKey)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 5),
    [agendas, todayKey]
  );

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-900 flex items-center space-x-2">
          <Calendar className="w-4 h-4 text-slate-500" />
          <span>Kalender Agenda Proyek</span>
        </h3>
        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={prevMonth}
            aria-label="Bulan sebelumnya"
            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-medium text-slate-800 min-w-[105px] text-center">
            {MONTH_NAMES[viewMonth]} {viewYear}
          </span>
          <button
            type="button"
            onClick={nextMonth}
            aria-label="Bulan berikutnya"
            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Month Grid */}
      <div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-400 mb-1">
          {DAY_NAMES.map((d) => (
            <div key={d} className="py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1 text-xs">
          {calendarCells.map((cell, idx) => {
            if (!cell) return <div key={`empty-${idx}`} className="h-8" />;
            const hasAgenda = (agendaByDate.get(cell.dateKey)?.length || 0) > 0;
            const isHoliday = holidayByDate.has(cell.dateKey);
            const isSelected = cell.dateKey === selectedDate;
            const isToday = cell.dateKey === todayKey;
            return (
              <button
                key={cell.dateKey}
                type="button"
                onClick={() => setSelectedDate(cell.dateKey)}
                className={`h-8 rounded-lg flex flex-col items-center justify-center relative font-mono tabular-nums transition-colors ${
                  isSelected
                    ? 'bg-[#0b0e14] text-[#d4f038] font-semibold'
                    : isToday
                    ? 'bg-slate-100 text-slate-900 font-semibold border border-slate-300'
                    : isHoliday
                    ? 'text-rose-600 hover:bg-rose-50'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span>{cell.day}</span>
                {(hasAgenda || isHoliday) && (
                  <span
                    className={`w-1 h-1 rounded-full absolute bottom-1 ${
                      isSelected ? 'bg-[#d4f038]' : isHoliday ? 'bg-rose-500' : 'bg-sky-500'
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Date / Upcoming Agendas */}
      <div className="border-t border-slate-100 pt-3 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-800 font-mono">
            Agenda: {selectedDate}
          </span>
          {selectedHoliday && (
            <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-medium">
              {selectedHoliday.name}
            </span>
          )}
        </div>

        {selectedAgendas.length > 0 ? (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {selectedAgendas.map((item) => (
              <div
                key={item.id}
                className="p-2 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 truncate flex items-center space-x-1.5">
                    {item.kind === 'milestone' && <Flag className="w-3 h-3 text-amber-600 shrink-0" />}
                    <span className="truncate">{item.title}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">{item.subtitle}</div>
                </div>
                {item.site && onOpenSiteWbs && (
                  <button
                    type="button"
                    onClick={() => onOpenSiteWbs(item.site!)}
                    className="px-2 py-1 rounded bg-[#d4f038] text-[#0b0e14] font-semibold text-[11px] shrink-0 flex items-center space-x-1"
                  >
                    <FolderTree className="w-3 h-3" />
                    <span>Buka</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1.5">
            <p className="text-[11px] text-slate-400">Tidak ada agenda proyek pada tanggal ini.</p>
            {upcomingAgendas.length > 0 && (
              <div className="pt-1 space-y-1">
                <span className="text-[11px] font-medium text-slate-600 block">Agenda terdekat:</span>
                {upcomingAgendas.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedDate(item.date)}
                    className="w-full text-left px-2 py-1 rounded hover:bg-slate-50 flex items-center justify-between text-[11px]"
                  >
                    <span className="text-slate-700 truncate">{item.title}</span>
                    <span className="font-mono text-slate-400 shrink-0 ml-2">{item.date}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
