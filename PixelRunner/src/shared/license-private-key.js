function readDerLength(bytes, offset) {
  if (offset >= bytes.length) throw new Error("DER 长度字段缺失");
  const first = bytes[offset];
  if (first < 0x80) return { length: first, nextOffset: offset + 1 };
  const lengthBytes = first & 0x7f;
  if (!lengthBytes || lengthBytes > 4 || offset + 1 + lengthBytes > bytes.length) {
    throw new Error("DER 长度字段无效");
  }
  let length = 0;
  for (let index = 0; index < lengthBytes; index += 1) length = (length << 8) | bytes[offset + 1 + index];
  return { length, nextOffset: offset + 1 + lengthBytes };
}

function readDerElement(bytes, offset) {
  if (offset >= bytes.length) throw new Error("DER 字段缺失");
  const tag = bytes[offset];
  const { length, nextOffset } = readDerLength(bytes, offset + 1);
  const valueStart = nextOffset;
  const valueEnd = valueStart + length;
  if (valueEnd > bytes.length) throw new Error("DER 字段长度超出范围");
  return { tag, valueStart, valueEnd, nextOffset: valueEnd };
}

function bytesEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function extractEd25519SeedFromPkcs8(der) {
  const bytes = der instanceof Uint8Array ? der : new Uint8Array(der || []);
  const outer = readDerElement(bytes, 0);
  if (outer.tag !== 0x30 || outer.valueEnd !== bytes.length) throw new Error("私钥不是有效的 PKCS#8 DER");
  let offset = outer.valueStart;
  const version = readDerElement(bytes, offset);
  if (version.tag !== 0x02) throw new Error("私钥缺少 PKCS#8 版本字段");
  offset = version.nextOffset;
  const algorithm = readDerElement(bytes, offset);
  if (algorithm.tag !== 0x30) throw new Error("私钥缺少算法字段");
  const algorithmBytes = bytes.slice(algorithm.valueStart, algorithm.valueEnd);
  const ed25519Oid = new Uint8Array([0x06, 0x03, 0x2b, 0x65, 0x70]);
  let matchesEd25519 = false;
  for (let index = 0; index <= algorithmBytes.length - ed25519Oid.length; index += 1) {
    if (bytesEqual(algorithmBytes.slice(index, index + ed25519Oid.length), ed25519Oid)) {
      matchesEd25519 = true;
      break;
    }
  }
  if (!matchesEd25519) throw new Error("私钥不是 Ed25519 格式");
  offset = algorithm.nextOffset;
  const privateKey = readDerElement(bytes, offset);
  if (privateKey.tag !== 0x04 || privateKey.nextOffset !== outer.valueEnd) throw new Error("私钥字段无效");
  const encodedSeed = bytes.slice(privateKey.valueStart, privateKey.valueEnd);
  if (encodedSeed.length === 32) return new Uint8Array(encodedSeed);
  const nestedSeed = readDerElement(encodedSeed, 0);
  if (nestedSeed.tag !== 0x04 || nestedSeed.valueEnd !== encodedSeed.length || nestedSeed.valueEnd - nestedSeed.valueStart !== 32) {
    throw new Error("Ed25519 私钥种子长度无效");
  }
  return new Uint8Array(encodedSeed.slice(nestedSeed.valueStart, nestedSeed.valueEnd));
}

export function decodeUnencryptedPkcs8Pem(text) {
  const normalized = String(text || "").trim();
  if (!normalized.includes("-----BEGIN PRIVATE KEY-----") || normalized.includes("-----BEGIN ENCRYPTED PRIVATE KEY-----")) {
    throw new Error("请选择未加密的 Ed25519 PKCS#8 PEM 私钥文件");
  }
  const base64 = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) throw new Error("PEM 内容无效");
  const binary = atob(base64);
  const der = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) der[index] = binary.charCodeAt(index);
  return der;
}
