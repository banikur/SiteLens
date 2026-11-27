import { Router } from "express";
import { requireAuth } from "../auth/middleware.ts";
import { registerProjectRoutes } from "./projects.ts";
import { registerWbsStageRoutes } from "./wbsStages.ts";
import { registerScurveWeatherRoutes } from "./scurveWeather.ts";
import { registerInspectionCapaRoutes } from "./inspectionsCapa.ts";
import { registerAdminRoutes } from "./admin.ts";

export const apiRouter = Router();
apiRouter.use(requireAuth);

registerProjectRoutes(apiRouter);
registerWbsStageRoutes(apiRouter);
registerScurveWeatherRoutes(apiRouter);
registerInspectionCapaRoutes(apiRouter);
registerAdminRoutes(apiRouter);
