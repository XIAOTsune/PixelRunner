export class HostLicenseStorageError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "HostLicenseStorageError";
    if (cause) this.cause = cause;
  }
}

function normalizeKey(key) {
  const normalized = String(key || "").trim();
  if (!normalized) throw new HostLicenseStorageError("Host 授权存储键无效");
  return normalized;
}

function resolveStorage(getStorage) {
  let storage;
  try {
    storage = getStorage();
  } catch (error) {
    throw new HostLicenseStorageError("Host 无法访问授权存储", error);
  }
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
    throw new HostLicenseStorageError("Host 未提供可用的授权存储");
  }
  return storage;
}

export function createHostLicenseStorage(getStorage = () => globalThis.localStorage) {
  if (typeof getStorage !== "function") throw new TypeError("getStorage 必须是函数");

  function getItem(key) {
    const normalizedKey = normalizeKey(key);
    try {
      const value = resolveStorage(getStorage).getItem(normalizedKey);
      return value == null ? null : String(value);
    } catch (error) {
      if (error instanceof HostLicenseStorageError) throw error;
      throw new HostLicenseStorageError("Host 读取授权存储失败", error);
    }
  }

  function setItem(key, value) {
    const normalizedKey = normalizeKey(key);
    const expectedValue = String(value == null ? "" : value);
    try {
      const storage = resolveStorage(getStorage);
      storage.setItem(normalizedKey, expectedValue);
      if (storage.getItem(normalizedKey) !== expectedValue) {
        throw new HostLicenseStorageError("Host 授权存储写入后校验失败");
      }
      return true;
    } catch (error) {
      if (error instanceof HostLicenseStorageError) throw error;
      throw new HostLicenseStorageError("Host 写入授权存储失败", error);
    }
  }

  return Object.freeze({ getItem, setItem });
}
