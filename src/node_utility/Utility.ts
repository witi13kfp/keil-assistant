export function arrayDelRepetition<T>(arr: T[]): T[] {
    return Array.from(new Set<T>(arr));
}