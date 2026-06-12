import { Router } from "express";
import { requireRole } from "../middleware/authMiddleware.js";
import { listAudit } from "../modules/audit/auditService.js";

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
