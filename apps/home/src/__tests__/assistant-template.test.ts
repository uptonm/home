import { describe, expect, mock, test } from 'bun:test'

const EMPTY_CTX = {
  config: {},
  json: false,
  quiet: true,
  verbose: false,
  log: null as unknown as ReturnType<typeof import('consola').createConsola>,
  args: {},
}

function errCode(r: { ok: boolean; code?: string }): string | undefined {
  return r.ok ? undefined : r.code
}

const realClient = await import('../modules/assistant/client')

let lastTemplate: string | undefined

mock.module('../modules/assistant/client', () => ({
  ...realClient,
  renderTemplate: async (_cfg: unknown, template: string) => {
    lastTemplate = template
    return `rendered:${template}`
  },
}))

const { templateRender } = await import('../modules/assistant/commands/template')

describe('assistant template', () => {
  test('command path and required template', () => {
    expect(templateRender.path).toEqual(['template'])
    expect(templateRender.args.find((a) => a.name === 'template')?.required).toBe(true)
  })

  test('rejects missing template', async () => {
    expect(errCode(await templateRender.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('renders the template and returns the text', async () => {
    const res = await templateRender.run({ ...EMPTY_CTX, args: { template: '{{ now() }}' } })
    expect(res.ok).toBe(true)
    expect((res as { data: string }).data).toBe('rendered:{{ now() }}')
    expect(lastTemplate).toBe('{{ now() }}')
  })
})
