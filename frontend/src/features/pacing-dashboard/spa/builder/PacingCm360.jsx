import { createContext, useContext } from 'react';

// The PACING's CM360 sentence for the widget being edited: what `cmRefusal(env)` answers
// (spotlight-items.js). It is null when this pacing can serve CM360, and otherwise says why it
// cannot (the file is not loaded, or no dimension mapping reads it).
//
// The three view cards compute that sentence themselves and hand it to their palette. A Layout
// block, a mini-chart line and a highlight rule sit several components below anything that
// holds the builder's env, so the builder provides the sentence once and an inline formula
// field that was handed no `cmUnavailable` of its own reads it here. Outside the builder there
// is no provider and the answer is null, which is what those fields printed before.
export const PacingCm360Context = createContext(null);
export const PacingCm360Provider = PacingCm360Context.Provider;
export const usePacingCm360 = () => useContext(PacingCm360Context);
