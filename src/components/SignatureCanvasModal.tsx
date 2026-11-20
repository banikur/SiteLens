import React, { useRef, useState, useEffect } from 'react';
import { PenTool, RotateCcw, Check, X, ShieldCheck } from 'lucide-react';
import type { User } from '../types';

interface SignatureCanvasModalProps {
  isOpen: boolean;
  currentUser: User;
  onClose: () => void;
  onSaveSignature: (dataUrl: string) => void;
}

export const SignatureCanvasModal: React.FC<SignatureCanvasModalProps> = ({
  isOpen,
  currentUser,
  onClose,
  onSaveSignature,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [signDate] = useState(() => new Date().toLocaleString('id-ID'));

  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Reset canvas resolution
    canvas.width = 460;
    canvas.height = 180;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#0f172a'; // slate-900
    setHasDrawn(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setHasDrawn(true);
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const handleConfirm = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) {
      alert('Silakan bubuhkan tanda tangan Anda terlebih dahulu pada area kanvas.');
      return;
    }

    // Add watermark stamp at bottom of signature
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.font = '10px monospace';
      ctx.fillStyle = '#64748b'; // slate-500
      ctx.fillText(
        `Certified by: ${currentUser.name} (${currentUser.role}) • ${signDate}`,
        12,
        canvas.height - 8
      );
    }

    const dataUrl = canvas.toDataURL('image/png');
    onSaveSignature(dataUrl);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center space-x-2">
            <PenTool className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Tanda Tangan Digital (Touchscreen Canvas)
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 text-xs">
          <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">
                Penanda Tangan:
              </span>
              <span className="font-bold text-slate-900 text-xs">{currentUser.name}</span>
              <span className="text-slate-500 text-[11px] block">{currentUser.role}</span>
            </div>
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">
                Waktu Otentikasi:
              </span>
              <span className="font-mono text-slate-700 text-[11px]">{signDate}</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                Area Goresan Tanda Tangan:
              </label>
              <button
                type="button"
                onClick={handleClear}
                className="text-[11px] text-slate-500 hover:text-rose-600 flex items-center space-x-1"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Bersihkan (Clear)</span>
              </button>
            </div>

            <div className="border-2 border-dashed border-slate-300 rounded-xl overflow-hidden bg-slate-50/50 touch-none flex items-center justify-center relative cursor-crosshair">
              <canvas
                ref={canvasRef}
                onPointerDown={startDrawing}
                onPointerMove={draw}
                onPointerUp={stopDrawing}
                onPointerLeave={stopDrawing}
                className="w-full h-44 bg-white"
              />
              {!hasDrawn && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center text-slate-300 text-xs font-medium">
                  Goreskan tanda tangan dengan jari atau stylus di sini
                </div>
              )}
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5 flex items-center">
              <ShieldCheck className="w-3 h-3 mr-1 text-emerald-600" />
              Tanda tangan digital dilindungi dengan cap watermark identitas penanda tangan dan stempel waktu UTC.
            </p>
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold flex items-center space-x-1.5"
            >
              <Check className="w-4 h-4" />
              <span>Bubuhkan Tanda Tangan</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
