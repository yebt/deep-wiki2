import { describe, expect, test } from 'bun:test';
import { impliedAllowActions, impliedDenyActions } from './actions';

const ACTIONS = ['read', 'comment', 'write', 'manage'] as const;

describe('impliedAllowActions', () => {
  test('allow(read) covers only read — nothing beneath it in the lattice', () => {
    expect(impliedAllowActions('read')).toEqual(['read']);
  });

  test('allow(write) covers read, comment and write but not manage', () => {
    expect(impliedAllowActions('write')).toEqual(['read', 'comment', 'write']);
  });

  test('allow(manage) covers every action, since manage sits above all of them', () => {
    expect(impliedAllowActions('manage')).toEqual(['read', 'comment', 'write', 'manage']);
  });
});

describe('impliedDenyActions', () => {
  test('deny(read) covers every action, since nothing is possible without read', () => {
    expect(impliedDenyActions('read')).toEqual(['read', 'comment', 'write', 'manage']);
  });

  test('deny(write) covers write and manage but not read or comment', () => {
    expect(impliedDenyActions('write')).toEqual(['write', 'manage']);
  });

  test('deny(manage) covers only manage, leaving read/comment/write untouched', () => {
    expect(impliedDenyActions('manage')).toEqual(['manage']);
  });
});

describe('lattice property', () => {
  test('allow(X) and deny(X) both include X itself for every action', () => {
    for (const action of ACTIONS) {
      expect(impliedAllowActions(action)).toContain(action);
      expect(impliedDenyActions(action)).toContain(action);
    }
  });

  test('allow(X) and deny(X) overlap in exactly one action: X itself', () => {
    for (const action of ACTIONS) {
      const overlap = impliedAllowActions(action).filter((a) => impliedDenyActions(action).includes(a));
      expect(overlap).toEqual([action]);
    }
  });
});
