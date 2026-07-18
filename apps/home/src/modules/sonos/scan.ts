const SONOS_PORT = 1400

/**
 * Expand an IPv4 CIDR (e.g. `10.0.10.0/24`) into its usable host addresses
 * (network and broadcast excluded). Throws on malformed input or a prefix
 * outside /22–/30 — wide enough for any home VLAN, narrow enough that a scan
 * never balloons past ~1022 probes.
 */
export function cidrHosts(cidr: string): string[] {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(cidr.trim())
  if (!m) throw new Error(`invalid CIDR "${cidr}" (expected e.g. 10.0.10.0/24)`)
  const octets = [m[1], m[2], m[3], m[4]].map(Number)
  if (octets.some((o) => o > 255)) throw new Error(`invalid CIDR "${cidr}" (octet > 255)`)
  const prefix = Number(m[5])
  if (prefix < 22 || prefix > 30) throw new Error(`CIDR prefix /${prefix} out of range (expected /22–/30)`)

  const base = ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0
  const size = 2 ** (32 - prefix)
  const network = (base & (~(size - 1) >>> 0)) >>> 0

  const hosts: string[] = []
  for (let i = 1; i < size - 1; i++) {
    const a = (network + i) >>> 0
    hosts.push(`${(a >>> 24) & 255}.${(a >>> 16) & 255}.${(a >>> 8) & 255}.${a & 255}`)
  }
  return hosts
}

/**
 * Config-field validator for the optional `subnet` setting: empty is allowed
 * (means "use SSDP multicast"); otherwise it must be a parseable CIDR.
 */
export function validateCidr(v: string): string | null {
  if (v.trim() === '') return null
  try {
    cidrHosts(v)
    return null
  } catch (err) {
    return (err as Error).message
  }
}

async function isSonos(host: string, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(`http://${host}:${SONOS_PORT}/xml/device_description.xml`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return false
    // Distinguishes a real ZonePlayer from anything else that happens to answer
    // on :1400 (e.g. a UPnP-event listener) so the topology walk gets a seed it
    // can actually enumerate from.
    return (await res.text()).includes('Sonos')
  } catch {
    return false
  }
}

/**
 * Scan a CIDR for one reachable Sonos and return its host, or null if none
 * responds. Bounded-concurrency, early-exit on the first hit — used to seed
 * `InitializeFromDevice` without hardcoding a (DHCP-assigned, drift-prone)
 * speaker IP. The topology walk discovers the rest of the household from there.
 */
export async function findSonosSeed(
  cidr: string,
  opts: { timeoutMs?: number; concurrency?: number } = {},
): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? 600
  const concurrency = opts.concurrency ?? 64
  const hosts = cidrHosts(cidr)

  let idx = 0
  let found: string | null = null
  async function worker(): Promise<void> {
    while (found === null && idx < hosts.length) {
      const host = hosts[idx++]!
      if (await isSonos(host, timeoutMs)) {
        if (found === null) found = host
        return
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker))
  return found
}
