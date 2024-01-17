declare global {
  namespace jest {
    interface Matchers<R> {
      toSqueeze(bytes: number[] | Uint8Array): R
    }
  }
}

export {}