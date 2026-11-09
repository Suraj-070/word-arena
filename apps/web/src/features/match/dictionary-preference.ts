import { DEFAULT_DICTIONARY_PRESET_ID, isDictionaryPresetId } from '@word-arena/engine';

export const DICTIONARY_PREFERENCE_KEY = 'word-arena.dictionary-preset';

export function readDictionaryPreference(): string {
  try {
    const stored = localStorage.getItem(DICTIONARY_PREFERENCE_KEY);
    if (stored && isDictionaryPresetId(stored)) return stored;
  } catch {
    return DEFAULT_DICTIONARY_PRESET_ID;
  }
  return DEFAULT_DICTIONARY_PRESET_ID;
}

export function writeDictionaryPreference(versionId: string): void {
  if (!isDictionaryPresetId(versionId)) return;
  localStorage.setItem(DICTIONARY_PREFERENCE_KEY, versionId);
}
