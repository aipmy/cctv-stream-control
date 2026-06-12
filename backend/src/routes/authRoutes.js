import { Router } from "express";
import {
  changePassword,
  getUserById,
  login,
  updatePreferences,
} from "../services/userService.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { auditRequest } from "../modules/audit/auditService.js";

export const authRoutes = Router();

authRoutes.post("/login", async (req, res, next) => {
  try {
    const result = await login(req.body?.username, req.body?.password);
    if (!result.ok) {
      await auditRequest(req, {
        actor: { username: String(req.body?.username || "anonymous") },
        action: "auth.login",
        outcome: "failure",
        target: { type: "user", label: String(req.body?.username || "") },
        details: { reason: result.error },
      });
      return res.status(401).json({ error: result.error });
    }
    await auditRequest(req, {
      actor: result.user,
      action: "auth.login",
      outcome: "success",
      target: { type: "user", id: result.user.id, label: result.user.username },
    });
    return res.json({ user: result.user, token: result.token });
  } catch (err) {
    await auditRequest(req, {
      actor: { username: String(req.body?.username || "anonymous") },
      action: "auth.login",
      outcome: "failure",
      details: { error: err?.message || "Login gagal" },
    });
    next(err);
  }
});

authRoutes.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await getUserById(req.auth?.sub);
    if (!user || !user.active) return res.status(401).json({ error: "Sesi tidak valid" });
    return res.json({ user });
  } catch (err) {
    next(err);
  }
});

authRoutes.patch("/preferences", requireAuth, async (req, res, next) => {
  try {
    const user = await updatePreferences(req.auth.sub, req.body);
    if (!user) return res.status(404).json({ error: "User not found" });
    await auditRequest(req, {
      action: "auth.preferences",
      outcome: "success",
      target: { type: "user", id: user.id, label: user.username },
      details: { pinnedCameraCount: user.preferences.pinnedCameraIds.length },
    });
    return res.json({ user });
  } catch (error) {
    await auditRequest(req, {
      action: "auth.preferences",
      outcome: "failure",
      details: { error: error?.message || "Preference gagal diperbarui" },
    });
    next(error);
  }
});

authRoutes.post("/password", requireAuth, async (req, res, next) => {
  try {
    const user = await changePassword(
      req.auth.sub,
      req.body?.currentPassword,
      req.body?.newPassword,
    );
    await auditRequest(req, {
      action: "auth.password",
      outcome: "success",
      target: { type: "user", id: user.id, label: user.username },
    });
    return res.json({ user });
  } catch (error) {
    await auditRequest(req, {
      action: "auth.password",
      outcome: "failure",
      target: { type: "user", id: req.auth?.sub, label: req.auth?.username },
      details: { error: error?.message || "Password gagal diubah" },
    });
    next(error);
  }
});

authRoutes.post("/logout", requireAuth, async (req, res, next) => {
  try {
    await auditRequest(req, {
      action: "auth.logout",
      outcome: "success",
      target: { type: "user", id: req.auth.sub, label: req.auth.username },
    });
    return res.status(204).end();
  } catch (error) {
    next(error);
  }
});
