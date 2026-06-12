import path from "node:path";
import { JsonStore } from "../core/jsonStore.js";
import { config } from "../core/config.js";
import { createUserService } from "../modules/users/userService.js";

const store = new JsonStore(path.join(config.dataDir, "users.json"), []);
const service = createUserService({ store });

export const {
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
} = service;
