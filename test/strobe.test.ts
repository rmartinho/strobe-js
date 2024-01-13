import { AuthenticationError, Strobe } from '../src/strobe'

function assertStrobeState(strobe: Strobe, bytes: number[]) {
  const buf = strobe.PRF(32)
  const expected = new Uint8Array(bytes)
  expect(buf).toEqual(expected)
}

test('initialize STROBE-128', () => {
  const s = new Strobe('test-init', 128)

  assertStrobeState(
    s,
    [
      0x76, 0x65, 0x56, 0x10, 0x2f, 0x14, 0x97, 0xe2, 0x16, 0x6, 0x82, 0xa7,
      0x20, 0x65, 0x32, 0x81, 0x1f, 0xb8, 0x2, 0xc5, 0xdf, 0x91, 0xe5, 0x31,
      0x3f, 0x26, 0x2a, 0x68, 0xfc, 0x5c, 0x9f, 0xc6,
    ]
  )
})

test('initialize STROBE-256', () => {
  const s = new Strobe('test-init', 256)

  assertStrobeState(
    s,
    [
      0xd, 0x15, 0x39, 0x44, 0x4c, 0xc5, 0xef, 0x5a, 0x6b, 0x1b, 0xc0, 0x9a,
      0xa, 0xe4, 0xfd, 0xd1, 0x19, 0x29, 0xa5, 0x3, 0xf1, 0x50, 0x99, 0xf8,
      0x53, 0x97, 0xc3, 0xe1, 0x28, 0x6b, 0x37, 0x52,
    ]
  )
})

test('sequence of operations', () => {
  const s = new Strobe('test-seq', 256)

  s.PRF(10)
  s.AD('Hello')
  s.sendENC(utf8('World'))
  s.sendCLR('foo')
  s.RATCHET(32)
  s.recvCLR('bar')
  s.recvENC(utf8('baz'))
  for (let i = 0; i < 100; ++i) {
    s.sendENC(utf8('X'.repeat(i)))
  }
  s.PRF(123)
  s.sendMAC(16)

  assertStrobeState(
    s,
    [
      0x8, 0x6, 0x34, 0x22, 0xb2, 0x34, 0x38, 0xf1, 0x8b, 0x52, 0x6f, 0xea,
      0xe8, 0x1a, 0x5a, 0x3a, 0xff, 0x0, 0x77, 0xcf, 0x88, 0x2, 0x86, 0x59,
      0x1c, 0x92, 0xf4, 0xc2, 0xc7, 0x42, 0x6c, 0x53,
    ]
  )
})

test('metadata', () => {
  const s = new Strobe('test-meta', 256)

  const out = []

  s.metaSendCLR('meta1')
  s.KEY(utf8('key'))
  {
    const buf = s.metaPRF(10)
    expect(buf).toEqual(
      new Uint8Array([
        0x37, 0xde, 0x35, 0x9d, 0x15, 0x58, 0xe2, 0x4, 0xda, 0x4b,
      ])
    )
  }
  {
    const buf = s.PRF(10)
    expect(buf).toEqual(
      new Uint8Array([0x60, 0xb, 0x27, 0xb, 0xfe, 0x15, 0x5, 0x88, 0x93, 0x31])
    )
  }
  s.metaSendCLR('meta3')
  {
    const buf = utf8('pt')
    s.sendENC(buf)
    expect(buf).toEqual(new Uint8Array([42, 198]))
  }

  assertStrobeState(
    s,
    [
      0xbe, 0x9a, 0xa1, 0xd7, 0x54, 0x86, 0xb2, 0x3a, 0xd7, 0xd2, 0x82, 0x3e,
      0x52, 0x95, 0x64, 0x2, 0xfc, 0xd7, 0x79, 0xe, 0xe5, 0xef, 0xaf, 0xa7,
      0x12, 0x1c, 0x1e, 0x47, 0x84, 0xa5, 0x4d, 0x8f,
    ]
  )
})

test('long inputs', () => {
  const s = new Strobe('test-long', 128)

  const BIG_N = 9823
  const bigData = new Uint8Array(BIG_N).fill(0x34)

  s.metaAD(bigData)
  s.AD(bigData)
  s.metaKEY(bigData)
  s.KEY(bigData)
  s.metaSendCLR(bigData)
  s.sendCLR(bigData)
  s.metaRecvCLR(bigData)
  s.recvCLR(bigData)

  s.metaSendENC(bigData.slice())
  s.sendENC(bigData.slice())
  s.metaRecvENC(bigData.slice())
  s.recvENC(bigData.slice())
  try {
    s.metaRecvMAC(bigData)
  } catch {}
  try {
    s.recvMAC(bigData)
  } catch {}
  s.metaRATCHET(BIG_N)
  s.RATCHET(BIG_N)
  s.metaPRF(BIG_N)
  s.PRF(BIG_N)
  s.metaSendMAC(BIG_N)
  s.sendMAC(BIG_N)

  assertStrobeState(
    s,
    [
      0x00, 0xb0, 0x7e, 0x46, 0x2b, 0x05, 0x16, 0x29, 0x1f, 0x34, 0x08, 0xf1,
      0x3c, 0xf1, 0xbf, 0x20, 0x5e, 0xac, 0x0e, 0x11, 0x9a, 0xf6, 0xf4, 0x4d,
      0x96, 0x35, 0x40, 0xe4, 0x4f, 0xa2, 0x1b, 0x72,
    ]
  )
})

test('streaming correctness', () => {
  const s1 = new Strobe('test-stream', 256)
  s1.AD('mynonce')
  s1.recvENC(utf8('hello there'))
  s1.sendMAC(16)
  s1.RATCHET(13)
  const oneShot = s1.PRF(32)

  const s2 = new Strobe('test-stream', 256)
  s2.AD('my')
  s2.AD('nonce', { more: true })
  s2.recvENC(utf8('hello'))
  s2.recvENC(utf8(' there'), { more: true })
  s2.sendMAC(10)
  s2.sendMAC(6, { more: true })
  s2.RATCHET(10)
  s2.RATCHET(3, { more: true })
  const streamed = s2.PRF(32)

  expect(oneShot).toEqual(streamed)
})

test('streaming soundness', () => {
  const s = new Strobe('test-stream', 256)
  s.KEY(utf8('secret'))
  s.KEY(utf8('sauce'), { more: true })

  expect(() => s.sendENC(utf8('testing'), { more: true })).toThrow()
})

test('encryption correctness', () => {
  const original = utf8('hello there')
  const tx = new Strobe('test-enc', 256)
  const rx = new Strobe('test-enc', 256)
  tx.KEY(utf8('the-combination-on-my-luggage'))
  rx.KEY(utf8('the-combination-on-my-luggage'))
  const buf = original.slice()
  tx.sendENC(buf)
  expect(buf).not.toEqual(original)
  rx.recvENC(buf)

  expect(buf).toEqual(original)
})

test('mac correctness and soundness', () => {
  const tx = new Strobe('test-mac', 256)
  const rx = new Strobe('test-mac', 256)
  tx.KEY(utf8('secretsauce'))
  rx.KEY(utf8('secretsauce'))

  const buf = utf8('attack at dawn')
  tx.sendENC(buf)
  rx.recvENC(buf)

  const mac = tx.sendMAC(16)
  const rx_copy = rx.clone()

  const bad_mac = mac.slice()
  bad_mac[0] ^= 1

  rx.recvMAC(mac)

  expect(() => rx_copy.recvMAC(bad_mac)).toThrow(AuthenticationError)
})

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}
