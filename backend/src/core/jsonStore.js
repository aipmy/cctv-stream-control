import fs from "node:fs/promises";
import path from "node:path";

export class JsonStore {
  constructor(filePath, fallbackValue) {
    this.filePath = filePath;
    this.fallbackValue = fallbackValue;
    this.writeLock = Promise.resolve();
    this.cache = undefined;
    this.ensured = false;
  }

  async ensure() {
    if (this.ensured) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      await this.write(this.fallbackValue);
    }
    this.ensured = true;
  }

  async read() {
    if (this.cache !== undefined) return this.cache;
    await this.ensure();
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.cache = JSON.parse(raw || "null") ?? this.fallbackValue;
    } catch {
      this.cache = this.fallbackValue;
    }
    return this.cache;
  }

  async write(value) {
    if (!this.ensured) {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      this.ensured = true;
    }
    const temp = `${this.filePath}.${Date.now()}.${Math.random().toString(36).substring(2, 8)}.tmp`;
    await fs.writeFile(temp, JSON.stringify(value, null, 2));
    await fs.rename(temp, this.filePath);
    this.cache = value;
    return value;
  }

  async update(mutator) {
    const operation = this.writeLock.then(async () => {
      const current = await this.read();
      const next = await mutator(current);
      await this.write(next);
      return next;
    });
    this.writeLock = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}
