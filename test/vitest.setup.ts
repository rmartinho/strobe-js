import { expect } from 'vitest'

import { Strobe } from '../src/strobe'

expect.extend({
  toSqueeze(received: Strobe, bytes: number[] | Uint8Array) {
    if (Array.isArray(bytes)) {
      bytes = new Uint8Array(bytes)
    }

    const out = received.clone().PRF(bytes.length)
    const pass: boolean = this.equals(out, bytes)
    return {
      pass,
      expected: bytes,
      received: out,
      message: () =>
        `${this.utils.matcherHint('toSqueeze', 'strobe', 'bytes', this)}`,
    }
  },
})
