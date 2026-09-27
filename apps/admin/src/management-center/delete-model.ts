/** The operator retypes the exact name; only surrounding spaces and Unicode composition are ignored. */
export function deleteNameConfirmed(typed: string, name: string): boolean {
  const expected = name.trim().normalize("NFC");
  return expected.length > 0 && typed.trim().normalize("NFC") === expected;
}
