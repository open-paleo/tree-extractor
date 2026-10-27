/**
 * A small seeded random number generator so synthetic cases are reproducible.
 */

/**
 * Mulberry32: fast, 32-bit state, good enough for layout and style choices.
 */
export class SeededRandom
{
    private state: number;

    /**
     * Seeds the generator.
     *
     * @param seed - Any integer.
     */
    public constructor(seed: number)
    {
        this.state = seed >>> 0;
    }

    /**
     * Draws a number in [0, 1).
     *
     * @returns The number.
     */
    public next(): number
    {
        this.state = (this.state + 0x6d2b79f5) >>> 0;
        let value = this.state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    }

    /**
     * Draws an integer in [low, high].
     *
     * @param low - Smallest value.
     * @param high - Largest value.
     * @returns The integer.
     */
    public nextInt(low: number, high: number): number
    {
        return low + Math.floor(this.next() * (high - low + 1));
    }

    /**
     * Draws a number in [low, high).
     *
     * @param low - Lower bound.
     * @param high - Upper bound.
     * @returns The number.
     */
    public nextBetween(low: number, high: number): number
    {
        return low + this.next() * (high - low);
    }

    /**
     * Returns true with the given probability.
     *
     * @param probability - Chance of true.
     * @returns The draw.
     */
    public chance(probability: number): boolean
    {
        return this.next() < probability;
    }

    /**
     * Picks one element.
     *
     * @param items - Non-empty list.
     * @returns A random element.
     */
    public pick<T>(items: Array<T>): T
    {
        return items[this.nextInt(0, items.length - 1)];
    }
}
