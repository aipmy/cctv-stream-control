import { createToken } from "../../core/auth.js";

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeUsername(value) {
  return String(value || "").trim();
}

function normalizePreferences(value) {
  const pinnedCameraIds = Array.isArray(value?.pinnedCameraIds)
    ? [...new Set(value.pinnedCameraIds
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean))]
      .slice(0, 500)
    : [];
  return { pinnedCameraIds };
}

export function publicUser(user) {
  if (!user) return null;
  const { password: _password, ...safe } = user;
  return {
    ...safe,
    permissions: user.permissions || {},
    allowedGroups: user.allowedGroups || [],
    preferences: normalizePreferences(user.preferences),
  };
}

export function createUserService({ store }) {
  async function listUsers() {
    return (await store.read()).map(publicUser);
  }

  async function getUserById(id) {
    return publicUser((await store.read()).find((user) => user.id === id));
  }

  async function setupStatus() {
    return { required: (await store.read()).length === 0 };
  }

  async function login(username, password) {
    const users = await store.read();
    const user = users.find((item) => item.username === username && item.password === password);
    if (!user) return { ok: false, error: "Username atau password salah" };
    if (!user.active) return { ok: false, error: "Akun nonaktif" };
    const safeUser = publicUser(user);
    return { ok: true, user: safeUser, token: createToken(user) };
  }

  async function createInitialAdmin(payload) {
    const username = normalizeUsername(payload?.username);
    const password = String(payload?.password || "");
    if (!username) throw httpError("Username wajib diisi", 400);
    if (!password) throw httpError("Password wajib diisi", 400);

    let created;
    await store.update((users) => {
      if (users.length > 0) throw httpError("Setup awal sudah selesai", 409);
      created = {
        id: `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        username,
        password,
        role: "admin",
        active: true,
        permissions: {},
        allowedGroups: [],
        preferences: normalizePreferences(),
      };
      return [created];
    });

    const user = publicUser(created);
    return { user, token: createToken(created) };
  }

  async function createUser(payload) {
    const username = normalizeUsername(payload?.username);
    if (!username) throw httpError("Username wajib diisi", 400);
    if (!payload?.password) throw httpError("Password wajib diisi", 400);
    const user = {
      id: `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      username,
      password: String(payload.password),
      role: payload.role || "guest",
      active: payload.active !== false,
      permissions: payload.permissions || {},
      allowedGroups: Array.isArray(payload.allowedGroups) ? payload.allowedGroups : [],
      preferences: normalizePreferences(payload.preferences),
    };
    await store.update((users) => {
      if (users.some((item) => item.username === user.username)) {
        throw httpError("Username sudah dipakai", 409);
      }
      return [...users, user].sort((a, b) => a.username.localeCompare(b.username));
    });
    return publicUser(user);
  }

  async function updateUser(id, payload) {
    let updated = null;
    await store.update((users) => users.map((user) => {
      if (user.id !== id) return user;
      const password = typeof payload.password === "string" && payload.password.length > 0
        ? payload.password
        : user.password;
      updated = {
        ...user,
        username: payload.username ?? user.username,
        password,
        role: payload.role ?? user.role,
        active: payload.active ?? user.active,
        permissions: payload.permissions ?? user.permissions ?? {},
        allowedGroups: payload.allowedGroups ?? user.allowedGroups ?? [],
        preferences: normalizePreferences(payload.preferences ?? user.preferences),
      };
      return updated;
    }).sort((a, b) => a.username.localeCompare(b.username)));
    return publicUser(updated);
  }

  async function updatePreferences(id, preferences) {
    let updated = null;
    await store.update((users) => users.map((user) => {
      if (user.id !== id) return user;
      updated = {
        ...user,
        preferences: normalizePreferences(preferences),
      };
      return updated;
    }));
    return publicUser(updated);
  }

  async function changePassword(id, currentPassword, newPassword) {
    if (!String(currentPassword || "")) throw httpError("Password saat ini wajib diisi", 400);
    if (!String(newPassword || "")) throw httpError("Password baru wajib diisi", 400);
    let updated = null;
    await store.update((users) => users.map((user) => {
      if (user.id !== id) return user;
      if (user.password !== currentPassword) {
        throw httpError("Password saat ini salah", 400);
      }
      updated = { ...user, password: String(newPassword) };
      return updated;
    }));
    if (!updated) throw httpError("User not found", 404);
    return publicUser(updated);
  }

  async function deleteUser(id) {
    let deleted = false;
    await store.update((users) => {
      deleted = users.some((user) => user.id === id);
      return users.filter((user) => user.id !== id);
    });
    return deleted;
  }

  return {
    listUsers,
    getUserById,
    setupStatus,
    login,
    createInitialAdmin,
    createUser,
    updateUser,
    updatePreferences,
    changePassword,
    deleteUser,
  };
}
