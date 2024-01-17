export function u8View(length: number): Uint8Array
export function u8View(data: number[]): Uint8Array
export function u8View(data: string): Uint8Array
export function u8View(data: ArrayBufferView): Uint8Array
export function u8View(
  data: number | number[] | string | ArrayBufferView
): Uint8Array

export function u8View(
  data: number | number[] | string | ArrayBufferView
): Uint8Array {
  if (typeof data === 'number') return new Uint8Array(data)
  else if (Array.isArray(data)) return new Uint8Array(data)
  else if (typeof data === 'string') return utf8(data)
  else return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

export function u8Merge(a: Uint8Array, b: Uint8Array): Uint8Array {
  const merged = new Uint8Array(a.length + b.length)
  merged.set(a)
  merged.set(b, a.length)
  return merged
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}
