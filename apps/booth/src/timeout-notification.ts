export const timeoutWarningText = (mode: string, left: number, warningSeconds: number) =>
  mode === 'limit' && left > 0 && left <= warningSeconds ? `Sesi berakhir dalam ${left} detik` : null;
