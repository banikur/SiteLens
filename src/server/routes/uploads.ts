import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { requireAuth } from '../auth/middleware.ts';

export const uploadsRouter = Router();

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = ALLOWED_EXT[file.mimetype] || '.jpg';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max per photo
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_EXT[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed.'));
    }
  },
});

uploadsRouter.post('/', requireAuth, upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No image file uploaded.' });
    return;
  }
  res.status(201).json({
    filename: req.file.filename,
    url: `/api/uploads/${req.file.filename}`,
    size: req.file.size,
  });
});

uploadsRouter.get('/:filename', requireAuth, (req: Request, res: Response) => {
  const safeName = path.basename(req.params.filename);
  const fullPath = path.join(UPLOAD_DIR, safeName);
  if (!fs.existsSync(fullPath)) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }
  res.sendFile(fullPath);
});

