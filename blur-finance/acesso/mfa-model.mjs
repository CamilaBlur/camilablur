export function totpHints(hints) {
  return (hints || []).filter(h => h.factorId === 'totp' && typeof h.uid === 'string' && h.uid.length > 0)
    .map(h => ({uid:h.uid,name:typeof h.displayName === 'string' && h.displayName ? h.displayName : 'Autenticador'}));
}
export function validTotp(code) { return typeof code === 'string' && code.length === 6 && /^[0-9]{6}$/.test(code); }
