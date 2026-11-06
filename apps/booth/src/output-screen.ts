export function outputScreen(status: string, quantity: number) {
  if (quantity === 0 && ['RENDERING', 'PRINTING', 'PRINT_SUCCESS', 'PRINT_FAILED', 'GENERATING_GALLERY', 'QR_READY'].includes(status)) return 'qr';
  if (['RENDERING', 'PRINTING', 'PRINT_SUCCESS', 'PRINT_FAILED', 'GENERATING_GALLERY'].includes(status)) return 'print';
  if (status === 'QR_READY') return 'qr';
  return null;
}
