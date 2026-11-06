import { expect, test } from 'vitest';
import { voucherErrorMessage } from './flow';
import { ApiError, NetworkError } from './api/client';

test('voucher errors: network vs server vs rejected code', () => {
  expect(voucherErrorMessage(new NetworkError('x'))).toMatch(/Koneksi terputus/);
  expect(voucherErrorMessage(new ApiError(502, 'HTTP_502', 'bad'))).toMatch(/Server sedang bermasalah/);
  expect(voucherErrorMessage(new ApiError(400, 'INVALID_VOUCHER', 'Kode voucher tidak ditemukan.'))).toBe('Kode voucher tidak ditemukan.');
  expect(voucherErrorMessage(new ApiError(400, 'HTTP_400', 'Voucher sudah habis', 'Voucher sudah habis'))).toBe('Voucher sudah habis');
});
