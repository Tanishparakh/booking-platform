import crypto from 'crypto';

/**
 * Mock/sandbox payment gateway. It behaves like a card gateway with escrow-style holds:
 * authorize -> capture (funds held by the platform) -> payout / refund, or void an authorization.
 * No real money moves. Test cards:
 *   4000000000000002  -> declined
 *   any other 16-digit number -> approved
 * A payout account ending in 0000 simulates a failed payout.
 *
 * The raw card number is used only to decide the outcome and is never stored.
 */
export interface PaymentGateway {
  authorize(amount: number, card: CardInput): Promise<{ ok: boolean; txnId?: string; brand?: string; last4?: string; reason?: string }>;
  capture(txnId: string): Promise<{ ok: boolean; reason?: string }>;
  void(txnId: string): Promise<{ ok: boolean }>;
  refund(txnId: string, amount: number): Promise<{ ok: boolean; refundId: string }>;
  payout(accountLast4: string, amount: number): Promise<{ ok: boolean; ref?: string; reason?: string }>;
}

export interface CardInput {
  number: string;
  expiry: string; // MM/YY
  cvv: string;
}

function brandOf(n: string): string {
  if (n.startsWith('4')) return 'VISA';
  if (/^5[1-5]/.test(n)) return 'MASTERCARD';
  if (/^3[47]/.test(n)) return 'AMEX';
  return 'CARD';
}

export const mockGateway: PaymentGateway = {
  async authorize(amount, card) {
    const number = card.number.replace(/\s|-/g, '');
    if (!/^\d{16}$/.test(number)) return { ok: false, reason: 'Invalid card number' };
    const m = /^(\d{2})\/(\d{2})$/.exec(card.expiry || '');
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return { ok: false, reason: 'Invalid card expiry' };
    const expiresEnd = new Date(2000 + Number(m[2]), Number(m[1]), 1); // first day after expiry month
    if (expiresEnd <= new Date()) return { ok: false, reason: 'Card has expired' };
    if (!/^\d{3,4}$/.test(card.cvv || '')) return { ok: false, reason: 'Invalid security code' };
    if (amount <= 0) return { ok: false, reason: 'Invalid amount' };
    const last4 = number.slice(-4);
    if (number === '4000000000000002') return { ok: false, reason: 'Card declined by issuer', brand: brandOf(number), last4 };
    return { ok: true, txnId: `mock_txn_${crypto.randomBytes(8).toString('hex')}`, brand: brandOf(number), last4 };
  },
  async capture(txnId) {
    return txnId.startsWith('mock_txn_') ? { ok: true } : { ok: false, reason: 'Unknown transaction' };
  },
  async void(txnId) {
    return { ok: txnId.startsWith('mock_txn_') };
  },
  async refund(_txnId, _amount) {
    return { ok: true, refundId: `mock_ref_${crypto.randomBytes(6).toString('hex')}` };
  },
  async payout(accountLast4, _amount) {
    if (accountLast4 === '0000') return { ok: false, reason: 'Bank rejected the transfer' };
    return { ok: true, ref: `mock_po_${crypto.randomBytes(6).toString('hex')}` };
  },
};

export const gateway: PaymentGateway = mockGateway;
