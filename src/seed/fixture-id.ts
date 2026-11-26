const PREFIX = {
  user: 'a1000000',
  account: 'a2000000',
  instrument: 'a3000000',
  order: 'a4000000',
  marketData: 'a5000000',
} as const;

export type FixtureEntity = keyof typeof PREFIX;

export function challengeFixtureId(
  entity: FixtureEntity,
  serial: number,
): string {
  if (!Number.isInteger(serial) || serial < 1) {
    throw new Error(`Fixture serial ${serial} is invalid.`);
  }

  return `${PREFIX[entity]}-0000-4000-8000-${serial.toString(16).padStart(12, '0')}`;
}
