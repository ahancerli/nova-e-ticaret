/**
 * Password rules for passwords people choose themselves (invitation, reset, storefront sign-up). Length beats
 * composition (NIST SP 800-63B): at least 10 characters, a letter and a digit, not the e-mail/name, not a
 * well-known password. Returned messages go straight to the form.
 */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

const COMMON = new Set([
  "1234567890", "12345678910", "0123456789", "qwertyuiop", "password1", "parola1234", "sifre12345", "şifre12345",
  "1q2w3e4r5t", "qwerty1234", "abc1234567", "aaaaaaaaaa1", "123456789a", "a123456789", "iloveyou12", "galatasaray1",
  "fenerbahce1", "besiktas1903", "trabzonspor1",
]);

export function passwordProblems(password: string, context: { email?: string; name?: string } = {}): string[] {
  const problems: string[] = [];
  const p = password.normalize("NFC");
  if ([...p].length < PASSWORD_MIN) problems.push(`En az ${PASSWORD_MIN} karakter olmalı.`);
  if ([...p].length > PASSWORD_MAX) problems.push(`En fazla ${PASSWORD_MAX} karakter olabilir.`);
  if (!/\p{L}/u.test(p) || !/\p{N}/u.test(p)) problems.push("En az bir harf ve bir rakam içermeli.");
  const lower = p.toLocaleLowerCase("tr-TR");
  if (COMMON.has(lower) || /^(.)\1+$/u.test(p)) problems.push("Çok yaygın bir parola; daha tahmin edilemez bir parola seçin.");
  const local = context.email?.split("@")[0]?.toLocaleLowerCase("tr-TR");
  if (local && local.length >= 4 && lower.includes(local)) problems.push("E-posta adresinizi içermemeli.");
  const firstName = context.name?.trim().split(/\s+/)[0]?.toLocaleLowerCase("tr-TR");
  if (firstName && firstName.length >= 4 && lower.includes(firstName)) problems.push("Adınızı içermemeli.");
  return problems;
}
