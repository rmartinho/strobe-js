import { keccakP } from '@noble/hashes/sha3'
import { u32 as u32View } from '@noble/hashes/utils'
import { u8Merge, u8View } from './utils.js'

type DuplexOptions = { before?: boolean; after?: boolean; force?: boolean }

const SPONGE_F = 'Keccak'
const SPONGE_BITS = 1600
const SPONGE_BYTES = SPONGE_BITS / 8
const STROBE_VERSION = '1.0.2'

enum Flags {
  None = 0,
  I = 1 << 0,
  A = 1 << 1,
  C = 1 << 2,
  T = 1 << 3,
  M = 1 << 4,
  K = 1 << 5,
  R1 = 1 << 6,
  R2 = 1 << 7,
  Reserved = R1 | R2,
  Unused = K | Reserved,
}

enum Role {
  Undecided = -1,
  Initiator = 0,
  Responder = Flags.I,
}

type AnyData = number | number[] | string | ArrayBufferView
export type OperationOptions = { more?: boolean }

export class Strobe {
  #sec: 128 | 256
  #state = new Uint8Array(SPONGE_BYTES)
  #pos = 0
  #pos_begin = 0
  #role = Role.Undecided
  #flags = Flags.None
  #rate: number

  constructor(proto: string)
  constructor(proto: string, sec: 128 | 256)
  constructor(source: Strobe)
  constructor(protoOrSource: string | Strobe, sec: 128 | 256 = 128) {
    if (protoOrSource instanceof Strobe) {
      const source = protoOrSource
      this.#rate = source.#rate
      this.#sec = source.#sec
      this.#pos = source.#pos
      this.#pos_begin = source.#pos_begin
      this.#role = source.#role
      this.#flags = source.#flags
      this.#state = source.#state.slice()
      this.#runF = this.#runFPad
    } else {
      const proto = protoOrSource
      this.#rate = SPONGE_BYTES - sec / 4
      this.#sec = sec
      this.#init(proto)
    }
  }

  get version() {
    return `Strobe-${SPONGE_F}-${this.#sec}/${SPONGE_BITS}-v${STROBE_VERSION}`
  }

  clone(): Strobe {
    return new Strobe(this)
  }

  #init(proto: string) {
    const sep = u8View(`STROBEv${STROBE_VERSION}`)
    const domain = u8Merge(
      new Uint8Array([0x01, this.#rate, 0x01, 0x00, 0x01, sep.byteLength * 8]),
      sep
    )
    this.#duplex(domain, { force: true })

    this.#rate -= 2
    this.#runF = this.#runFPad
    this.metaAD(proto)
  }

  #runF = this.#runFCore

  #runFPad() {
    this.#state[this.#pos] ^= this.#pos_begin
    this.#state[this.#pos + 1] ^= 0x04
    this.#state[this.#rate + 1] ^= 0x80
    this.#runFCore()
  }
  #runFCore() {
    keccakP(u32View(this.#state))
    this.#pos = this.#pos_begin = 0
  }

  #duplex(
    input: AnyData,
    { before, after, force }: DuplexOptions = {}
  ): Uint8Array {
    console.assert(
      !(before && after),
      'both `before` and `after` were specified for duplex'
    )
    const data = u8View(input)

    for (let i = 0; i < data.length; i++) {
      if (before) data[i] ^= this.#state[this.#pos]
      this.#state[this.#pos] ^= data[i]
      if (after) data[i] = this.#state[this.#pos]

      this.#pos++
      if (this.#pos == this.#rate) this.#runF()
    }
    if (force && this.#pos != 0) this.#runF()

    return data
  }

  #beginOp(flags: Flags) {
    if (flags & Flags.T) {
      if (this.#role == Role.Undecided) {
        this.#role =
          (flags & Flags.I) != Flags.None ? Role.Responder : Role.Initiator
      }
      flags ^= this.#role == Role.Responder ? Flags.I : Flags.None
    }

    const old_begin = this.#pos_begin
    this.#pos_begin = this.#pos + 1

    this.#absorb([old_begin, flags])

    if ((flags & (Flags.C | Flags.K)) != Flags.None && this.#pos != 0) {
      this.#runF()
    }
  }

  #validateStreaming(flags: Flags, { more }: OperationOptions = {}) {
    if (more) {
      if (flags != this.#flags) {
        throw new Error('used `more` with a different operation')
      }
    }
    this.#flags = flags
  }

  #operateMutate(
    flags: Flags,
    data: AnyData,
    { more }: OperationOptions = {}
  ): Uint8Array | void {
    if ((flags & Flags.Unused) != Flags.None) {
      throw new Error('unimplemented flags were used')
    }

    this.#validateStreaming(flags, { more })
    if (!more) {
      this.#beginOp(flags)
    }

    flags &= ~Flags.M
    if ((flags & (Flags.C | Flags.T | Flags.I)) == (Flags.C | Flags.T)) {
      if (flags == (Flags.C | Flags.T)) {
        this.#copyState(u8View(data))
      } else {
        this.#absorbAndSet(u8View(data))
      }
    } else if (flags == (Flags.I | Flags.A | Flags.C)) {
      this.#squeeze(u8View(data))
    } else if ((flags & Flags.C) != Flags.None) {
      this.#exchange(u8View(data))
    } else {
      console.assert(false, 'called operateMutate for non-mutating op')
    }
  }

  #operateNoMutate(
    flags: Flags,
    data: AnyData,
    { more }: OperationOptions = {}
  ): Uint8Array | void {
    if ((flags & Flags.Unused) != Flags.None) {
      throw new Error('unimplemented flags were used')
    }

    this.#validateStreaming(flags, { more })
    if (!more) {
      this.#beginOp(flags)
    }

    if ((flags & (Flags.C | Flags.T | Flags.I)) == (Flags.C | Flags.T)) {
      console.assert(false, 'called operateNoMutate for mutating op')
    } else if ((flags & Flags.C) != Flags.None) {
      this.#overwrite(u8View(data))
    } else {
      this.#absorb(u8View(data))
    }
  }

  #absorb(data: Iterable<number>) {
    for (const b of data) {
      this.#state[this.#pos] ^= b
      this.#pos++
      if (this.#pos == this.#rate) this.#runF()
    }
  }

  #absorbAndSet(data: Uint8Array) {
    for (let i = 0; i < data.length; ++i) {
      data[i] = this.#state[this.#pos] ^= data[i]
      this.#pos++
      if (this.#pos == this.#rate) this.#runF()
    }
  }

  #copyState(data: Uint8Array) {
    for (let i = 0; i < data.length; ++i) {
      data[i] = this.#state[this.#pos]
      this.#pos++
      if (this.#pos == this.#rate) this.#runF()
    }
  }

  #exchange(data: Uint8Array) {
    for (let i = 0; i < data.length; ++i) {
      this.#state[this.#pos] ^= data[i] ^= this.#state[this.#pos]
      this.#pos++
      if (this.#pos == this.#rate) this.#runF()
    }
  }

  #overwrite(data: Uint8Array) {
    for (const b of data) {
      this.#state[this.#pos] = b
      this.#pos++
      if (this.#pos == this.#rate) this.#runF()
    }
  }

  #squeeze(data: Uint8Array) {
    for (let i = 0; i < data.length; ++i) {
      data[i] = this.#state[this.#pos]
      this.#state[this.#pos] = 0
      this.#pos++
      if (this.#pos == this.#rate) this.#runF()
    }
  }

  #zeroState(length: number) {
    let bytesRemaining = length
    while (bytesRemaining > 0) {
      const len = Math.min(this.#rate - this.#pos, bytesRemaining)
      this.#state.subarray(this.#pos, this.#pos + len).fill(0)
      this.#pos += len
      bytesRemaining -= len
      if (this.#pos == this.#rate) this.#runF()
    }
  }

  #doAD(
    data: string | ArrayBufferView,
    opts: OperationOptions,
    meta: Flags.None | Flags.M = Flags.None
  ): void {
    this.#operateNoMutate(Flags.A | meta, data, opts)
  }

  AD(data: string | ArrayBufferView, opts: OperationOptions = {}): void {
    this.#doAD(data, opts)
  }

  metaAD(data: string | ArrayBufferView, opts: OperationOptions = {}): void {
    this.#doAD(data, opts, Flags.M)
  }

  #doKEY(
    data: string | ArrayBufferView,
    opts: OperationOptions,
    meta: Flags.None | Flags.M = Flags.None
  ): void {
    this.#operateNoMutate(Flags.A | Flags.C | meta, data, opts)
  }

  KEY(data: ArrayBufferView, opts: OperationOptions = {}): void {
    this.#doKEY(data, opts)
  }

  metaKEY(data: ArrayBufferView, opts: OperationOptions = {}): void {
    this.#doKEY(data, opts, Flags.M)
  }

  #doSendCLR(
    data: string | ArrayBufferView,
    opts: OperationOptions,
    meta: Flags.None | Flags.M = Flags.None
  ): void {
    this.#operateNoMutate(Flags.A | Flags.T | meta, data, opts)
  }

  sendCLR(data: string | ArrayBufferView, opts: OperationOptions = {}): void {
    this.#doSendCLR(data, opts)
  }

  metaSendCLR(
    data: string | ArrayBufferView,
    opts: OperationOptions = {}
  ): void {
    this.#doSendCLR(data, opts, Flags.M)
  }

  #doRecvCLR(
    data: string | ArrayBufferView,
    opts: OperationOptions,
    meta: Flags.None | Flags.M = Flags.None
  ): void {
    this.#operateNoMutate(Flags.I | Flags.A | Flags.T | meta, data, opts)
  }

  recvCLR(data: string | ArrayBufferView, opts: OperationOptions = {}): void {
    this.#doRecvCLR(data, opts)
  }

  metaRecvCLR(
    data: string | ArrayBufferView,
    opts: OperationOptions = {}
  ): void {
    this.#doRecvCLR(data, opts, Flags.M)
  }

  #doSendENC(
    data: ArrayBufferView,
    opts: OperationOptions,
    meta: Flags.None | Flags.M = Flags.None
  ): void {
    this.#operateMutate(Flags.A | Flags.C | Flags.T | meta, data, opts)
  }

  sendENC(data: ArrayBufferView, opts: OperationOptions = {}): void {
    this.#doSendENC(data, opts)
  }

  metaSendENC(data: ArrayBufferView, opts: OperationOptions = {}): void {
    this.#doSendENC(data, opts, Flags.M)
  }

  #doRecvENC(
    data: ArrayBufferView,
    opts: OperationOptions,
    meta: Flags.None | Flags.M = Flags.None
  ): void {
    this.#operateMutate(
      Flags.I | Flags.A | Flags.C | Flags.T | meta,
      data,
      opts
    )
  }

  recvENC(data: ArrayBufferView, opts: OperationOptions = {}): void {
    this.#doRecvENC(data, opts)
  }

  metaRecvENC(data: ArrayBufferView, opts: OperationOptions = {}): void {
    this.#doRecvENC(data, opts, Flags.M)
  }

  #doSendMAC(
    data: Uint8Array,
    opts: OperationOptions,
    meta: Flags.None | Flags.M = Flags.None
  ): Uint8Array {
    this.#operateMutate(Flags.C | Flags.T | meta, data, opts)
    return data
  }

  sendMAC(length: number, opts?: OperationOptions): Uint8Array
  sendMAC(dest: ArrayBufferView, opts?: OperationOptions): void
  sendMAC(
    destOrLength: number | ArrayBufferView,
    opts: OperationOptions = {}
  ): Uint8Array | void {
    return this.#doSendMAC(u8View(destOrLength), opts)
  }

  metaSendMAC(length: number, opts?: OperationOptions): Uint8Array
  metaSendMAC(dest: ArrayBufferView, opts?: OperationOptions): void
  metaSendMAC(
    destOrLength: number | ArrayBufferView,
    opts: OperationOptions = {}
  ): Uint8Array | void {
    return this.#doSendMAC(u8View(destOrLength), opts, Flags.M)
  }

  #doRecvMAC(
    data: ArrayBufferView,
    { more }: OperationOptions,
    meta: Flags.None | Flags.M = Flags.None
  ) {
    console.assert(!more, 'used MAC operation with `more`')

    const copy = u8Copy(data)

    this.#operateMutate(Flags.I | Flags.C | Flags.T | meta, copy, { more })
    let failures = copy.reduce((a, b) => a | b, 0)
    if (failures != 0) throw new AuthenticationError()
  }

  recvMAC(data: ArrayBufferView, opts: OperationOptions = {}): void {
    this.#doRecvMAC(data, opts)
  }

  metaRecvMAC(data: ArrayBufferView, opts: OperationOptions = {}): void {
    this.#doRecvMAC(data, opts, Flags.M)
  }

  #doPRF(
    data: Uint8Array,
    opts: OperationOptions,
    meta: Flags.None | Flags.M = Flags.None
  ) {
    this.#operateMutate(Flags.I | Flags.A | Flags.C | meta, data, opts)
    return data
  }

  PRF(length: number, opts?: OperationOptions): Uint8Array
  PRF(dest: ArrayBufferView, opts?: OperationOptions): void
  PRF(
    destOrLength: number | ArrayBufferView,
    opts: OperationOptions = {}
  ): Uint8Array | void {
    return this.#doPRF(u8View(destOrLength), opts)
  }

  metaPRF(length: number, opts?: OperationOptions): Uint8Array
  metaPRF(dest: ArrayBufferView, opts?: OperationOptions): void
  metaPRF(
    destOrLength: number | ArrayBufferView,
    opts: OperationOptions = {}
  ): Uint8Array | void {
    return this.#doPRF(u8View(destOrLength), opts, Flags.M)
  }

  #doRATCHET(
    length: number,
    { more }: OperationOptions,
    meta: Flags.None | Flags.M = Flags.None
  ) {
    this.#validateStreaming(Flags.C | meta, { more })
    if (!more) {
      this.#beginOp(Flags.C | meta)
    }
    this.#zeroState(length)
  }

  RATCHET(length: number = this.#sec / 8, opts: OperationOptions = {}): void {
    this.#doRATCHET(length, opts)
  }

  metaRATCHET(
    length: number = this.#sec / 8,
    opts: OperationOptions = {}
  ): void {
    this.#doRATCHET(length, opts, Flags.M)
  }
}

export class AuthenticationError extends Error {
  constructor(message?: string) {
    super(message ?? 'invalid MAC')
    this.name = 'AuthenticationError'
  }
}

function zeroBuffer(buffer: ArrayBufferView) {
  new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).fill(0)
}

function u8Copy(length: number): Uint8Array
function u8Copy(data: number[]): Uint8Array
function u8Copy(data: string): Uint8Array
function u8Copy(data: ArrayBufferView): Uint8Array
function u8Copy(data: AnyData): Uint8Array

function u8Copy(data: AnyData): Uint8Array {
  const view = u8View(data)
  if (
    typeof data === 'number' ||
    Array.isArray(data) ||
    typeof data === 'string'
  ) {
    return view
  } else {
    return new Uint8Array(view)
  }
}
