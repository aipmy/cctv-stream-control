import { Router } from "express";
import { createInitialAdmin, setupStatus } from "../services/userService.js";
import { auditRequest } from "../modules/audit/auditService.js";

export const setupRoutes = Router();

setupRoutes.get("/status", async (_req, res, next) => {
  try {
    res.json(await setupStatus());
  } catch (error) {
    next(error);
  }
});

setupRoutes.post("/admin", async (req, res, next) => {
  try {
    const result = await createInitialAdmin(req.body);
    await auditRequest(req, {
      actor: result.user,
      action: "auth.setup",
      outcome: "success",
      target: { type: "user", id: result.user.id, label: result.user.username },
    });
    res.status(201).json(result);
  } catch (error) {
    await auditRequest(req, {
      actor: { username: String(req.body?.username || "anonymous") },
      action: "auth.setup",
      outcome: "failure",
      target: { type: "user", label: String(req.body?.username || "") },
      details: { error: error?.message || "Setup gagal" },
    });
    next(error);
  }
});
