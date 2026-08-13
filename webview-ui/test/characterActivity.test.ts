/// <reference lib="dom" />

import { describe, expect, it } from 'vitest';

import { createCharacter, updateCharacter } from '../src/office/engine/characters.js';
import { CharacterState } from '../src/office/types.js';

describe('character activity', () => {
  it('keeps an open terminal idle until real agent activity arrives', () => {
    const character = createCharacter(1, 0, null, null);

    expect(character.isActive).toBe(false);
    expect(character.state).toBe(CharacterState.IDLE);
  });

  it('returns an idle character to work when the runtime marks it active', () => {
    const character = createCharacter(1, 0, null, null);
    character.isActive = true;

    updateCharacter(character, 0.1, [], new Map(), [], new Set());

    expect(character.state).toBe(CharacterState.TYPE);
  });
});
