import { describe, expect, mock, test } from 'bun:test'
import { EMPTY_CTX, asDevice, data, realSonosClient } from './sonos-fakes'

let injected: ReturnType<typeof asDevice> | null = null
mock.module('../modules/sonos/client', () => ({
  ...realSonosClient,
  withRoom: async (_ctx: unknown, _opts: unknown, fn: (d: ReturnType<typeof asDevice>) => unknown) => fn(injected!),
}))

const { playersGet, buildPlayerDetail } = await import('../modules/sonos/commands/players')

const SUMMARY = { name: 'Kitchen', uuid: 'RINCON_K', host: '10.0.0.5', group: 'Kitchen', isCoordinator: true }

describe('buildPlayerDetail', () => {
  test('merges topology, zone info, and device description', () => {
    const d = buildPlayerDetail(SUMMARY, {
      zoneInfo: { SerialNumber: 'SER-1', SoftwareVersion: '56.0', HardwareVersion: '1.20.1', IPAddress: '10.0.0.5', MACAddress: 'AA:BB:CC' },
      desc: { manufacturer: 'Sonos, Inc.', modelName: 'Sonos One', modelNumber: 'S13' },
      ledState: 'On',
      icon: 'x-rincon-roomicon:kitchen',
    })
    expect(d).toMatchObject({
      name: 'Kitchen',
      isCoordinator: true,
      model: 'Sonos One',
      modelNumber: 'S13',
      manufacturer: 'Sonos, Inc.',
      serial: 'SER-1',
      softwareVersion: '56.0',
      hardwareVersion: '1.20.1',
      ip: '10.0.0.5',
      mac: 'AA:BB:CC',
      ledOn: true,
      icon: 'x-rincon-roomicon:kitchen',
    })
  })

  test('zone info wins over device description for overlapping fields', () => {
    const d = buildPlayerDetail(SUMMARY, {
      zoneInfo: { SerialNumber: 'ZONE-SER', SoftwareVersion: '56.0' },
      desc: { serialNumber: 'DESC-SER', softwareVersion: '40.0', hardwareVersion: '1.0' },
    })
    expect(d.serial).toBe('ZONE-SER')
    expect(d.softwareVersion).toBe('56.0')
    // falls back to desc when zone info lacks the field
    expect(d.hardwareVersion).toBe('1.0')
  })

  test('led state maps On/Off to boolean, undefined stays undefined', () => {
    expect(buildPlayerDetail(SUMMARY, { ledState: 'On' }).ledOn).toBe(true)
    expect(buildPlayerDetail(SUMMARY, { ledState: 'Off' }).ledOn).toBe(false)
    expect(buildPlayerDetail(SUMMARY, {}).ledOn).toBeUndefined()
  })

  test('ip falls back to the topology host when zone info is missing', () => {
    expect(buildPlayerDetail(SUMMARY, { zoneInfo: null }).ip).toBe('10.0.0.5')
  })
})

function makePlayerDevice(opts: { failDesc?: boolean } = {}) {
  return asDevice({
    Name: 'Kitchen',
    Uuid: 'RINCON_K',
    Host: '10.0.0.5',
    GroupName: 'Kitchen',
    Coordinator: { Uuid: 'RINCON_K' },
    DevicePropertiesService: {
      GetZoneInfo: async () => ({ SerialNumber: 'SER-1', SoftwareVersion: '56.0', HardwareVersion: '1.20.1', IPAddress: '10.0.0.5', MACAddress: 'AA:BB:CC' }),
      GetZoneAttributes: async () => ({ CurrentZoneName: 'Kitchen', CurrentIcon: 'x-rincon-roomicon:kitchen', CurrentConfiguration: '1' }),
      GetLEDState: async () => ({ CurrentLEDState: 'On' }),
    },
    GetDeviceDescription: opts.failDesc
      ? async () => { throw new Error('not supported') }
      : async () => ({ manufacturer: 'Sonos, Inc.', modelName: 'Sonos One', modelNumber: 'S13' }),
  })
}

describe('players get (command)', () => {
  test('returns the merged device detail', async () => {
    injected = makePlayerDevice()
    const res = await playersGet.run({ ...EMPTY_CTX, args: { room: 'kitchen' } })
    expect(res.ok).toBe(true)
    expect(data(res)).toMatchObject({
      name: 'Kitchen',
      isCoordinator: true,
      model: 'Sonos One',
      serial: 'SER-1',
      ledOn: true,
    })
  })

  test('a failed device-description call still yields the rest of the detail', async () => {
    injected = makePlayerDevice({ failDesc: true })
    const res = await playersGet.run({ ...EMPTY_CTX, args: { room: 'kitchen' } })
    expect(res.ok).toBe(true)
    expect(data(res).model).toBeUndefined()
    expect(data(res).serial).toBe('SER-1') // from GetZoneInfo, unaffected
  })

  test('declares the expected command path', () => {
    expect(playersGet.path).toEqual(['players', 'get'])
    expect(playersGet.args[0]?.required).toBe(true)
  })
})
