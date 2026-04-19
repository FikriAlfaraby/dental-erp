// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/prisma', () => import('../__mocks__/prisma'))

vi.mock('@/lib/api-helpers', () => ({
  requireAuthAndRole: vi.fn(),
}))

// ── Imports (after mocks) ────────────────────────────────────────────────────

import {
  GET as instrumentsGET,
  POST as instrumentsPOST,
} from '@/app/api/sterilization/instruments/route'
import { GET as instrumentDetailGET } from '@/app/api/sterilization/instruments/[id]/route'
import { requireAuthAndRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// ── Auth helpers ─────────────────────────────────────────────────────────────

function mockAuth(overrides: Record<string, unknown> = {}) {
  const defaults = {
    error: null,
    user: { id: 'u1', name: 'Admin', role: 'ADMIN' },
    hospitalId: 'h1',
  }
  vi.mocked(requireAuthAndRole).mockResolvedValue({ ...defaults, ...overrides } as any)
}

function mockAuthError() {
  vi.mocked(requireAuthAndRole).mockResolvedValue({
    error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  } as any)
}

function makeReq(path: string, method = 'GET', body?: any): Request {
  const url = `http://localhost${path}`
  const init: any = { method }
  if (body) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  return new Request(url, init)
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. GET/POST /api/sterilization/instruments
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/sterilization/instruments', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await instrumentsGET(makeReq('/api/sterilization/instruments'))
    expect(res.status).toBe(401)
  })

  it('returns instruments with log counts', async () => {
    mockAuth()
    vi.mocked(prisma.instrument.findMany).mockResolvedValue([
      {
        id: 'i1',
        name: 'Forceps #1',
        category: 'EXTRACTION',
        status: 'AVAILABLE',
        serialNumber: 'SN001',
        _count: { sterilizationLogs: 12 },
      },
      {
        id: 'i2',
        name: 'Mirror',
        category: 'EXAMINATION',
        status: 'IN_USE',
        serialNumber: 'SN002',
        _count: { sterilizationLogs: 5 },
      },
    ] as any)

    const res = await instrumentsGET(makeReq('/api/sterilization/instruments'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.instruments).toHaveLength(2)
    expect(body.instruments[0]._count.sterilizationLogs).toBe(12)
  })

  it('applies search filter', async () => {
    mockAuth()
    vi.mocked(prisma.instrument.findMany).mockResolvedValue([])

    await instrumentsGET(makeReq('/api/sterilization/instruments?search=forceps'))

    expect(prisma.instrument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([expect.objectContaining({ name: { contains: 'forceps' } })]),
        }),
      })
    )
  })

  it('filters by status and category', async () => {
    mockAuth()
    vi.mocked(prisma.instrument.findMany).mockResolvedValue([])

    await instrumentsGET(
      makeReq('/api/sterilization/instruments?status=AVAILABLE&category=EXTRACTION')
    )

    expect(prisma.instrument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'AVAILABLE',
          category: 'EXTRACTION',
        }),
      })
    )
  })
})

describe('POST /api/sterilization/instruments', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await instrumentsPOST(
      makeReq('/api/sterilization/instruments', 'POST', { name: 'Test' })
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 when name or category missing', async () => {
    mockAuth()
    const res = await instrumentsPOST(
      makeReq('/api/sterilization/instruments', 'POST', { name: 'Test' })
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain('category')
  })

  it('creates instrument successfully', async () => {
    mockAuth()
    vi.mocked(prisma.instrument.create).mockResolvedValue({
      id: 'i1',
      name: 'Forceps #5',
      category: 'EXTRACTION',
      serialNumber: 'SN005',
    } as any)

    const res = await instrumentsPOST(
      makeReq('/api/sterilization/instruments', 'POST', {
        name: 'Forceps #5',
        category: 'EXTRACTION',
        serialNumber: 'SN005',
      })
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.instrument.name).toBe('Forceps #5')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. GET /api/sterilization/instruments/[id]
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/sterilization/instruments/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockAuthError()
    const res = await instrumentDetailGET(makeReq('/api/sterilization/instruments/i1'), {
      params: Promise.resolve({ id: 'i1' }),
    })
    expect(res.status).toBe(401)
  })

  it('returns instrument details with sterilization logs', async () => {
    mockAuth()
    vi.mocked(prisma.instrument.findFirst).mockResolvedValue({
      id: 'i1',
      name: 'Forceps',
      category: 'EXTRACTION',
      serialNumber: 'SN001',
      sterilizationLogs: [
        {
          id: 'sl1',
          method: 'AUTOCLAVE',
          result: 'PASS',
          cycleNumber: 5,
          temperature: { toNumber: () => 134 },
          pressure: { toNumber: () => 2.1 },
        },
      ],
    } as any)

    const res = await instrumentDetailGET(makeReq('/api/sterilization/instruments/i1'), {
      params: Promise.resolve({ id: 'i1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.instrument.id).toBe('i1')
    expect(body.instrument.sterilizationLogs).toHaveLength(1)
  })

  it('returns 404 when instrument not found', async () => {
    mockAuth()
    vi.mocked(prisma.instrument.findFirst).mockResolvedValue(null)

    const res = await instrumentDetailGET(makeReq('/api/sterilization/instruments/i-missing'), {
      params: Promise.resolve({ id: 'i-missing' }),
    })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toBe('Instrument not found')
  })
})
