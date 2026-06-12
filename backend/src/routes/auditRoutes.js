import { Router } from "express";
import { requireRole } from "../middleware/authMiddleware.js";
import { listAudit, clearAudit, exportAudit } from "../modules/audit/auditService.js";

export const auditRoutes = Router();

auditRoutes.use(requireRole("admin"));

auditRoutes.get("/", (req, res, next) => {
  try {
    res.json(listAudit({
      limit: req.query.limit,
      cursor: req.query.cursor,
      actor: req.query.actor,
      action: req.query.action,
      outcome: req.query.outcome,
    }));
  } catch (error) {
    next(error);
  }
});

auditRoutes.post("/clear", async (req, res, next) => {
  try {
    await clearAudit();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

auditRoutes.get("/export", async (req, res, next) => {
  try {
    const data = await exportAudit();
    res.setHeader("Content-Disposition", 'attachment; filename="audit_logs.json"');
    res.setHeader("Content-Type", "application/json");
    res.json(data);
  } catch (error) {
    next(error);
  }
});
