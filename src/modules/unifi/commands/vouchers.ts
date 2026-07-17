import type { CommandSpec } from '../../../core/types'
import { readUnifiConfig } from '../client'
import {
  integrationCreateVouchers,
  integrationDeleteVoucher,
  integrationGetVoucher,
  integrationListVouchers,
} from '../integration-client'

export const vouchersList: CommandSpec = {
  path: ['vouchers', 'list'],
  effect: 'read',
  description: 'List hotspot guest vouchers (Integration API, paginated)',
  args: [],
  examples: [
    'home unifi vouchers list',
    "home unifi vouchers list --json | jq '.[] | {id, code, name}'",
  ],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const data = await integrationListVouchers(cfg)
    return { ok: true, data }
  },
}

export const vouchersGet: CommandSpec = {
  path: ['vouchers', 'get'],
  effect: 'read',
  description: 'Fetch a single hotspot voucher by its Integration API id',
  args: [{ name: 'id', kind: 'positional', description: 'Voucher id', required: true }],
  examples: ['home unifi vouchers get 661a1f2c0e9b4d00010a2b3c --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const id = String(ctx.args.id ?? '').trim()
    if (!id) return { ok: false, kind: 'user', message: 'id is required', code: 'missing_arg' }
    const data = await integrationGetVoucher(cfg, id)
    if (!data) return { ok: false, kind: 'user', message: `no voucher with id ${id}`, code: 'not_found' }
    return { ok: true, data }
  },
}

export const vouchersCreate: CommandSpec = {
  path: ['vouchers', 'create'],
  effect: 'write',
  description: 'Create one or more hotspot guest vouchers (write — requires --yes)',
  args: [
    { name: 'count', kind: 'number', description: 'How many vouchers to create', default: 1 },
    { name: 'minutes', kind: 'number', description: 'Validity window in minutes (time limit)', default: 1440 },
    { name: 'name', kind: 'string', description: 'Note/name for the voucher batch' },
    { name: 'quota', kind: 'number', description: 'Max devices that may redeem each voucher (0 = unlimited)' },
    { name: 'yes', kind: 'boolean', description: 'Confirm the write — vouchers create is a mutation' },
  ],
  examples: [
    'home unifi vouchers create --count 5 --minutes 1440 --name "Guest day pass" --yes',
    'home unifi vouchers create --minutes 60 --yes',
  ],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)

    const count = Number(ctx.args.count ?? 1)
    if (!Number.isInteger(count) || count < 1) {
      return { ok: false, kind: 'user', message: 'count must be a positive integer', code: 'invalid_arg' }
    }
    const minutes = Number(ctx.args.minutes ?? 1440)
    if (!Number.isInteger(minutes) || minutes < 1) {
      return { ok: false, kind: 'user', message: 'minutes must be a positive integer', code: 'invalid_arg' }
    }
    let quota: number | undefined
    if (ctx.args.quota !== undefined) {
      quota = Number(ctx.args.quota)
      if (!Number.isInteger(quota) || quota < 0) {
        return { ok: false, kind: 'user', message: 'quota must be a non-negative integer', code: 'invalid_arg' }
      }
    }
    const name = ctx.args.name !== undefined ? String(ctx.args.name) : undefined

    if (!ctx.args.yes) {
      return {
        ok: false,
        kind: 'user',
        message: `refusing to create ${count} voucher(s) without confirmation — re-run with --yes`,
        code: 'confirmation_required',
      }
    }

    const data = await integrationCreateVouchers(cfg, {
      count,
      timeLimitMinutes: minutes,
      ...(name !== undefined ? { name } : {}),
      ...(quota !== undefined ? { authorizedGuestLimit: quota } : {}),
    })
    return { ok: true, data }
  },
}

export const vouchersDelete: CommandSpec = {
  path: ['vouchers', 'delete'],
  effect: 'destructive',
  description: 'Delete a hotspot voucher by id (write — requires --yes)',
  args: [
    { name: 'id', kind: 'positional', description: 'Voucher id', required: true },
    { name: 'yes', kind: 'boolean', description: 'Confirm the deletion — this is irreversible' },
  ],
  examples: ['home unifi vouchers delete 661a1f2c0e9b4d00010a2b3c --yes'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const id = String(ctx.args.id ?? '').trim()
    if (!id) return { ok: false, kind: 'user', message: 'id is required', code: 'missing_arg' }

    if (!ctx.args.yes) {
      return {
        ok: false,
        kind: 'user',
        message: `refusing to delete voucher ${id} without confirmation — re-run with --yes`,
        code: 'confirmation_required',
      }
    }

    const data = await integrationDeleteVoucher(cfg, id)
    return { ok: true, data: data ?? { id, deleted: true } }
  },
}
