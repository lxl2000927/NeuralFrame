import type { Game } from "../../ui/src/types";

export function matches(game: Game, filters: { query?: string; api?: string; dlss?: string; addon?: string }, newDlss?: string | null): boolean;
export function versions(games: Game[]): string[];
export function hasDlss(game: Game): boolean;
export function canInstall(game: Game): boolean;
export function apiKey(game: Game): string;
