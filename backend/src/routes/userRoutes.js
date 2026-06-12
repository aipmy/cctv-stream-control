import { Router } from "express";
import { createUser, deleteUser, getUserById, listUsers, updateUser } from "../services/userService.js";
import { requireRole } from "../middleware/authMiddleware.js";
import { auditRequest, changedFields } from "../modules/audit/auditService.js";

export const userRoutes = Router();

userRoutes.use(requireRole("admin"));

userRoutes.get("/", async (_req, res, next) => {
  try { res.json(await listUsers()); } catch (err) { next(err); }
});

userRoutes.post("/", async (req, res, next) => {
  try {
    const user = await createUser(req.body);
    await auditRequest(req, {
      action: "user.create",
      outcome: "success",
      target: { type: "user", id: user.id, label: user.username },
      details: { role: user.role, active: user.active },
    });
    res.status(201).json(user);
  } catch (err) {
    await auditRequest(req, {
      action: "user.create",
      outcome: "failure",
      target: { type: "user", label: String(req.body?.username || "") },
      details: { error: err?.message || "Gagal membuat user" },
    });
    next(err);
  }
});

userRoutes.put("/:id", async (req, res, next) => {
  try {
    const user = await updateUser(req.params.id, req.body);
    if (!user) return res.status(404).json({ error: "User not found" });
    await auditRequest(req, {
      action: "user.update",
      outcome: "success",
      target: { type: "user", id: user.id, label: user.username },
      details: {
        changedFields: changedFields(req.body, ["username", "password", "role", "active"]),
      },
    });
    res.json(user);
  } catch (err) {
    await auditRequest(req, {
      action: "user.update",
      outcome: "failure",
      target: { type: "user", id: req.params.id },
      details: { error: err?.message || "Gagal memperbarui user" },
    });
    next(err);
  }
});

userRoutes.delete("/:id", async (req, res, next) => {
  try {
    const user = await getUserById(req.params.id);
    const ok = await deleteUser(req.params.id);
    if (!ok) return res.status(404).json({ error: "User not found" });
    await auditRequest(req, {
      action: "user.delete",
      outcome: "success",
      target: { type: "user", id: req.params.id, label: user?.username || null },
    });
    res.status(204).end();
  } catch (err) {
    await auditRequest(req, {
      action: "user.delete",
      outcome: "failure",
      target: { type: "user", id: req.params.id },
      details: { error: err?.message || "Gagal menghapus user" },
    });
    next(err);
  }
});
