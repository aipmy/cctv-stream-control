import fs from "node:fs/promises";
import path from "node:path";

export class JsonStore {
  constructor(filePath, fallbackValue) {
    this.filePath = filePath;
    this.fallbackValue = fallbackValue;
    this.writeLock = Promise.resolve();
  }

  async ensure() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      await this.write(this.fallbackValue);
    }
  }

  async read() {
    await this.ensure();
    const raw = await fs.readFile(this.filePath, "utf8");
    return JSON.parse(raw || "null") ?? this.fallbackValue;
  }

  async write(value) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${Date.now()}.${Math.random().toString(36).substring(2, 8)}.tmp`;
    await fs.writeFile(temp, JSON.stringify(value, null, 2));
    await fs.rename(temp, this.filePath);
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
