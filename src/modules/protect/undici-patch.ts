/**
 * Bun's built-in undici shim is missing a handful of methods the
 * `unifi-protect` SDK depends on. We patch them here so the SDK can
 * initialize, log in, and clean up under Bun.
 *
 * Side-effect-only module — import once before `unifi-protect`.
 */
import { Agent, Pool } from 'undici'

interface PatchableProto {
  compose?: (...args: unknown[]) => unknown
  destroy?: (...args: unknown[]) => unknown
  close?: (...args: unknown[]) => unknown
}

const poolProto = Pool.prototype as unknown as PatchableProto
const agentProto = Agent.prototype as unknown as PatchableProto

// 1. Pool.compose — the SDK chains retry + user-agent interceptors via
//    `new Pool(...).compose(ua, interceptors.retry(...))`. We can't apply
//    interceptors under Bun, so make compose a no-op that returns the
//    dispatcher itself. SDK loses its retry layer, but requests still go.
if (typeof poolProto.compose !== 'function') {
  poolProto.compose = function (this: unknown) {
    return this
  }
}

// 2. Agent.destroy — Bun's Agent shim doesn't ship destroy(). The SDK's
//    error/cleanup path calls wsAgent?.destroy(), so we stub it.
if (typeof agentProto.destroy !== 'function') {
  agentProto.destroy = function (this: { close?: () => unknown }) {
    if (typeof this.close === 'function') return this.close()
    return Promise.resolve()
  }
}

// 3. Pool.destroy — the SDK calls dispatcher?.destroy() on reset/logout.
//    Bun's Pool shim doesn't ship destroy(). Same shape as Agent.destroy.
if (typeof poolProto.destroy !== 'function') {
  poolProto.destroy = function (this: { close?: () => unknown }) {
    if (typeof this.close === 'function') return this.close()
    return Promise.resolve()
  }
}

// 4. Pool.close — defensive: not currently called but used as a fallback
//    for our destroy stub above.
if (typeof poolProto.close !== 'function') {
  poolProto.close = function () {
    return Promise.resolve()
  }
}
