import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@testing-library/jest-dom'
import WalletConnectModal from './WalletConnectModal'

// ---------------------------------------------------------------------------
// Mock WalletContext
// ---------------------------------------------------------------------------

const mockConnectFreighter = vi.fn()
const mockDisconnect = vi.fn()

let mockWalletState: {
  publicKey: string | null
  keypair: any
  connected: boolean
  ready: boolean
  connectionMethod: string | null
  freighterAvailable: boolean
  connect: ReturnType<typeof vi.fn>
  connectFreighter: typeof mockConnectFreighter
  disconnect: typeof mockDisconnect
  hasCompletedWizard: boolean
  completeWizard: ReturnType<typeof vi.fn>
}

vi.mock('../../context/WalletContext', () => ({
  useWallet: () => mockWalletState,
  WalletProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  InvalidKeypairError: class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'InvalidKeypairError'
    }
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultClosed = () =>
  render(<WalletConnectModal isOpen={false} onClose={vi.fn()} />)

const defaultOpen = (onClose = vi.fn()) =>
  render(<WalletConnectModal isOpen={true} onClose={onClose} />)

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()

  mockWalletState = {
    publicKey: null,
    keypair: null,
    connected: false,
    ready: false,
    connectionMethod: null,
    freighterAvailable: false,
    connect: vi.fn(),
    connectFreighter: mockConnectFreighter,
    disconnect: mockDisconnect,
    hasCompletedWizard: true,
    completeWizard: vi.fn(),
  }

  // Default: desktop user agent
  Object.defineProperty(navigator, 'userAgent', {
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    writable: true,
    configurable: true,
  })

  // Provide a stub clipboard API
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WalletConnectModal – closed', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = defaultClosed()
    expect(container.firstChild).toBeNull()
  })
})

describe('WalletConnectModal – no extension installed', () => {
  beforeEach(() => {
    mockWalletState.freighterAvailable = false
    mockWalletState.connected = false
  })

  it('shows install CTA with link to freighter.app', () => {
    defaultOpen()

    const link = screen.getByRole('link', { name: /install freighter/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', 'https://freighter.app')
  })

  it('does not show the Connect Freighter button', () => {
    defaultOpen()
    expect(screen.queryByRole('button', { name: /connect freighter/i })).not.toBeInTheDocument()
  })
})

describe('WalletConnectModal – extension present, not connected', () => {
  beforeEach(() => {
    mockWalletState.freighterAvailable = true
    mockWalletState.connected = false
  })

  it('shows the Connect Freighter button', () => {
    defaultOpen()
    expect(screen.getByRole('button', { name: /connect with freighter/i })).toBeInTheDocument()
  })

  it('shows a loading spinner while connectFreighter is in-flight', async () => {
    // Keep the promise pending so we can observe the loading state
    let resolveConnect!: () => void
    mockConnectFreighter.mockReturnValueOnce(
      new Promise<void>((res) => {
        resolveConnect = res
      })
    )

    defaultOpen()
    fireEvent.click(screen.getByRole('button', { name: /connect with freighter/i }))

    // Spinner should appear immediately
    expect(await screen.findByRole('status', { name: /connecting/i })).toBeInTheDocument()

    // Resolve and confirm spinner disappears
    resolveConnect()
    await waitFor(() => {
      expect(screen.queryByRole('status', { name: /connecting/i })).not.toBeInTheDocument()
    })
  })

  it('calls connectFreighter when the button is clicked', async () => {
    mockConnectFreighter.mockResolvedValueOnce(undefined)
    defaultOpen()

    fireEvent.click(screen.getByRole('button', { name: /connect with freighter/i }))

    await waitFor(() => {
      expect(mockConnectFreighter).toHaveBeenCalledOnce()
    })
  })
})

describe('WalletConnectModal – connected state', () => {
  const TEST_KEY = 'GABCDEFGH12345678901234567890123456789012345678LMNOPQRS'

  beforeEach(() => {
    mockWalletState.connected = true
    mockWalletState.publicKey = TEST_KEY
    mockWalletState.freighterAvailable = true
  })

  it('shows a truncated public key', () => {
    defaultOpen()
    // First 8 chars + "..." + last 8 chars
    const truncated = `${TEST_KEY.slice(0, 8)}...${TEST_KEY.slice(-8)}`
    expect(screen.getByText(truncated)).toBeInTheDocument()
  })

  it('shows a copy-to-clipboard button', () => {
    defaultOpen()
    expect(screen.getByRole('button', { name: /copy public key/i })).toBeInTheDocument()
  })

  it('copies the full public key to clipboard when copy is clicked', async () => {
    defaultOpen()
    fireEvent.click(screen.getByRole('button', { name: /copy public key/i }))

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(TEST_KEY)
    })
  })

  it('shows a disconnect button', () => {
    defaultOpen()
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument()
  })

  it('calls disconnect and onClose when disconnect is clicked', async () => {
    const onClose = vi.fn()
    render(<WalletConnectModal isOpen={true} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }))

    expect(mockDisconnect).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('WalletConnectModal – error state', () => {
  beforeEach(() => {
    mockWalletState.freighterAvailable = true
    mockWalletState.connected = false
  })

  it('shows an error message when connectFreighter rejects', async () => {
    mockConnectFreighter.mockRejectedValueOnce(new Error('User rejected the request'))
    defaultOpen()

    fireEvent.click(screen.getByRole('button', { name: /connect with freighter/i }))

    expect(await screen.findByText('User rejected the request')).toBeInTheDocument()
  })

  it('shows a Retry button after an error', async () => {
    mockConnectFreighter.mockRejectedValueOnce(new Error('Something went wrong'))
    defaultOpen()

    fireEvent.click(screen.getByRole('button', { name: /connect with freighter/i }))

    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('retries the connection when Retry is clicked', async () => {
    mockConnectFreighter
      .mockRejectedValueOnce(new Error('Timeout'))
      .mockResolvedValueOnce(undefined)

    defaultOpen()

    fireEvent.click(screen.getByRole('button', { name: /connect with freighter/i }))
    await screen.findByRole('button', { name: /retry/i })

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    await waitFor(() => {
      expect(mockConnectFreighter).toHaveBeenCalledTimes(2)
    })
  })
})

describe('WalletConnectModal – mobile deep link', () => {
  beforeEach(() => {
    // Simulate a mobile user agent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 Mobile Safari/537.36',
      writable: true,
      configurable: true,
    })
    mockWalletState.freighterAvailable = false
    mockWalletState.connected = false
  })

  it('shows the Freighter deep-link button on mobile', () => {
    defaultOpen()
    expect(screen.getByRole('link', { name: /open freighter app/i })).toBeInTheDocument()
  })

  it('deep-link href contains the encoded current origin', () => {
    defaultOpen()
    const link = screen.getByRole('link', { name: /open freighter app/i })
    const expectedHref = `freighter://connect?origin=${encodeURIComponent(window.location.origin)}`
    expect(link).toHaveAttribute('href', expectedHref)
  })

  it('does not show the install CTA on mobile', () => {
    defaultOpen()
    expect(screen.queryByRole('link', { name: /install freighter/i })).not.toBeInTheDocument()
  })
})
