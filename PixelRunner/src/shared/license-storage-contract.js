export function assertHostStorageWriteAcknowledged(result) {
  if (result !== true) {
    throw new Error("宿主授权存储未确认写入");
  }
  return true;
}
