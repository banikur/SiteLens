import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import { checkDbHealth } from './src/server/db/index.ts';
import { attachSessionUser } from './src/server/auth/middleware.ts';
import { authRouter } from './src/server/routes/auth.ts';
import { apiRouter } from './src/server/routes/api.ts';
import { uploadsRouter } from './src/server/routes/uploads.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  app.use(attachSessionUser);
  app.use('/api/auth', authRouter);
  app.use('/api/uploads', uploadsRouter);
  app.use('/api', apiRouter);

  app.get('/api/health', async (_req, res) => {
    const dbStatus = await checkDbHealth();
    const aiConfigured = Boolean(getAiClient());
    res.status(dbStatus === 'error' ? 503 : 200).json({
      status: dbStatus === 'error' ? 'degraded' : 'ok',
      database: dbStatus,
      aiConfigured,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/ai/status', (_req, res) => {
    res.json({ enabled: Boolean(getAiClient()) });
  });

  // AI Checklist Template Generator Endpoint
  app.post('/api/templates/generate', async (req, res) => {
    try {
      const ai = getAiClient();
      if (!ai) {
        res.status(503).json({
          code: 'AI_NOT_CONFIGURED',
          error: 'GEMINI_API_KEY is not configured on this server. You can still build templates manually or use offline OCR.',
        });
        return;
      }
      const {
        prompt,
        category = 'Safety & HSE',
        language = 'en',
        requiresApproval = true,
        targetRole = 'QC Inspector',
        approvalRole = 'Site Engineer',
      } = req.body;

      if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
        res.status(400).json({ error: 'Prompt specification is required.' });
        return;
      }

      const langInstruction =
        language === 'id'
          ? 'Generate all titles, section titles, descriptions, field labels, helper descriptions, and dropdown/status options in professional Bahasa Indonesia (Indonesian construction & industrial terminology). Keep standard codes (e.g., SNI, ISO, OSHA, ASME, ACI) accurate.'
          : 'Generate all titles, section titles, descriptions, field labels, helper descriptions, and dropdown/status options in professional English (construction & industrial engineering terminology).';

      const systemInstruction = `You are a senior construction, civil engineering, QA/QC, and HSE operations architect.
Convert the user's raw Standard Operating Procedure (SOP), work method statement, equipment checklist, or inspection scope into a comprehensive, realistic, and structured SiteLens inspection checklist template.
${langInstruction}

Rules for structuring the checklist:
1. Create 2 to 4 logical sections grouping the inspection flow (e.g., Preparation & Safety, Visual & Structural Checks, Functional / Measurement Readings, Sign-off & Handover).
2. Each section should contain 3 to 6 specific, actionable checklist fields.
3. Use diverse, appropriate field types from this exact list:
   - 'instruction' (for safety warnings or SOP prerequisites at the start of a section)
   - 'pass_fail' (for physical compliance checkpoints)
   - 'yes_no' (for binary verification questions)
   - 'status_select' (provide 3 options like ['Normal', 'Caution', 'Critical'] or Indonesian ['Normal', 'Perhatian', 'Kritis'])
   - 'number' (always provide a realistic engineering 'unit' such as 'mm', 'psi', 'bar', '°C', 'km/h', 'kN', '%', 'dB')
   - 'dropdown' (provide 3-4 realistic choices in 'options')
   - 'short_text' (for serial numbers, tag IDs, contractor names)
   - 'long_text' (for remedial notes or detailed observations)
   - 'date' or 'time' (if relevant to permits or calibration)
   - 'photo' (for photographic field evidence)
   - 'signature' (for operator, inspector, or supervisor sign-off at the end)
4. Where a 'pass_fail' field is critical, you may add a follow-up 'photo' or 'long_text' field in the same section with 'conditionalOnPreviousFail: true' so it triggers dynamically if the prior check fails.
5. Include realistic engineering standard references in 'helpStandard' (e.g., 'SNI 2847:2019', 'OSHA 1926.1412', 'ISO 9001', 'ACI 318', 'Permenaker No. 8 Tahun 2020').`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Target Category: ${category}\nTarget Inspector Role: ${targetRole}\n\nUser Specification / SOP Input:\n${prompt}`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: {
                type: Type.STRING,
                description: 'Concise, professional checklist template title.',
              },
              category: {
                type: Type.STRING,
                description:
                  'One of: Safety & HSE, Civil & Structural, Heavy Equipment, Quality Control, Environmental, Site Logistics',
              },
              description: {
                type: Type.STRING,
                description: 'Clear 1-2 sentence overview of the inspection purpose and scope.',
              },
              estimatedMinutes: {
                type: Type.INTEGER,
                description: 'Estimated time in minutes to execute in the field (15 to 60).',
              },
              tags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '3 to 5 relevant technical tags.',
              },
              sections: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: {
                      type: Type.STRING,
                      description: 'Section title (e.g. Section 1: Structural Integrity).',
                    },
                    description: {
                      type: Type.STRING,
                      description: 'Brief instruction for this section.',
                    },
                    fields: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          type: {
                            type: Type.STRING,
                            description:
                              'One of: short_text, long_text, number, pass_fail, yes_no, status_select, dropdown, date, time, photo, signature, instruction',
                          },
                          label: {
                            type: Type.STRING,
                            description: 'The inspection question or verification checkpoint label.',
                          },
                          description: {
                            type: Type.STRING,
                            description: 'Acceptance criteria or helper guidance for the inspector.',
                          },
                          required: {
                            type: Type.BOOLEAN,
                            description: 'True if mandatory (false for instructions or conditional items).',
                          },
                          unit: {
                            type: Type.STRING,
                            description: 'Engineering unit if type is number (e.g. mm, psi, °C).',
                          },
                          options: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING },
                            description: 'Options list if type is dropdown or status_select.',
                          },
                          helpStandard: {
                            type: Type.STRING,
                            description: 'Reference code or regulation (e.g. ACI 318, SNI, ISO 4309).',
                          },
                          conditionalOnPreviousFail: {
                            type: Type.BOOLEAN,
                            description:
                              'Set to true if this photo or note field should only appear when the preceding pass_fail field in this section fails.',
                          },
                        },
                        required: ['type', 'label', 'required'],
                      },
                    },
                  },
                  required: ['title', 'fields'],
                },
              },
            },
            required: ['title', 'category', 'description', 'estimatedMinutes', 'tags', 'sections'],
          },
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);

      const validCategories = [
        'Safety & HSE',
        'Civil & Structural',
        'Heavy Equipment',
        'Quality Control',
        'Environmental',
        'Site Logistics',
      ];
      const validFieldTypes = [
        'short_text',
        'long_text',
        'number',
        'pass_fail',
        'yes_no',
        'status_select',
        'dropdown',
        'date',
        'time',
        'photo',
        'signature',
        'instruction',
      ];

      const timestamp = Date.now();
      const normalizedSections = (parsed.sections || []).map((sec: any, sIdx: number) => {
        let lastPassFailFieldId: string | null = null;
        const fields = (sec.fields || []).map((f: any, fIdx: number) => {
          const fieldId = `fld-ai-${timestamp}-${sIdx}-${fIdx}`;
          const fType = validFieldTypes.includes(f.type) ? f.type : 'pass_fail';

          const condition =
            f.conditionalOnPreviousFail && lastPassFailFieldId
              ? {
                  dependsOnFieldId: lastPassFailFieldId,
                  operator: 'equals' as const,
                  value: 'fail',
                }
              : undefined;

          if (fType === 'pass_fail') {
            lastPassFailFieldId = fieldId;
          }

          return {
            id: fieldId,
            type: fType,
            label: f.label || 'Inspection Checkpoint',
            description: f.description || undefined,
            required: fType === 'instruction' ? false : Boolean(f.required ?? true),
            unit: fType === 'number' ? f.unit || 'mm' : undefined,
            options:
              fType === 'dropdown' || fType === 'status_select'
                ? Array.isArray(f.options) && f.options.length > 0
                  ? f.options
                  : fType === 'status_select'
                  ? language === 'id'
                    ? ['Normal', 'Perhatian', 'Kritis']
                    : ['Normal', 'Caution', 'Critical']
                  : ['Option 1', 'Option 2', 'Option 3']
                : undefined,
            helpStandard: f.helpStandard || undefined,
            condition,
          };
        });

        return {
          id: `sec-ai-${timestamp}-${sIdx}`,
          title: sec.title || `Section ${sIdx + 1}`,
          description: sec.description || '',
          fields,
        };
      });

      const resolvedCategory = validCategories.includes(parsed.category)
        ? parsed.category
        : validCategories.includes(category)
        ? category
        : 'Safety & HSE';

      const today = new Date().toISOString().split('T')[0];

      const template = {
        id: `tmpl-ai-${timestamp}`,
        title: parsed.title || 'AI Generated Inspection Protocol',
        category: resolvedCategory,
        description:
          parsed.description ||
          'Generated from project specification and standard operating procedures.',
        version: '1.0',
        targetRole,
        requiresApproval: Boolean(requiresApproval),
        approvalRole,
        estimatedMinutes: Number(parsed.estimatedMinutes) || 25,
        tags: Array.isArray(parsed.tags) && parsed.tags.length > 0 ? parsed.tags : ['AI Generated', 'SOP'],
        createdAt: today,
        updatedAt: today,
        authorName: req.body.authorName || 'Marcus Chen',
        authorRole: req.body.authorRole || 'QC Inspector',
        sections: normalizedSections,
      };

      res.json({ template });
    } catch (error: any) {
      console.error('AI Template Generation Error:', error);
      res.status(500).json({
        error:
          error?.message ||
          'Failed to generate checklist template from specification. Please check your prompt or try again.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SiteLens server running on http://localhost:${PORT}`);
  });
}

startServer();
