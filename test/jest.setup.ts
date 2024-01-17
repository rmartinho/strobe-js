import { Strobe } from '../src/strobe'

expect.extend({
  toSqueeze(received: Strobe, bytes: number[] | Uint8Array) {
    if (Array.isArray(bytes)) {
      bytes = new Uint8Array(bytes)
    }
    const options = {
      isNot: this.isNot,
      promise: this.promise,
    }

    const out = received.clone().PRF(bytes.length)
    const pass: boolean = this.equals(out, bytes)
    return {
      pass,
      message: pass
        ? () =>
            `${this.utils.matcherHint(
              'toSqueeze',
              'strobe',
              'bytes',
              options
            )}\n\n` + `Expected: ${this.utils.printExpected(bytes)}`
        : () =>
            `${this.utils.matcherHint(
              'toSqueeze',
              'strobe',
              'bytes',
              options
            )}\n\n` +
            `Expected: ${this.utils.printExpected(bytes)}\n` +
            `Received: ${this.utils.printReceived(out)}`,
    }
  },
})
