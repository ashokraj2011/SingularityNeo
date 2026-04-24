import { describe, expect, it } from 'vitest';
import { getRouteDescription } from '../routeDescriptions';

describe('getRouteDescription', () => {
  it('resolves the root landing surface', () => {
    const desc = getRouteDescription('/');
    expect(desc?.label).toBe('Work');
    expect(desc?.purpose).toMatch(/operate one work item/i);
  });

  it('resolves primary aliases back to the same description', () => {
    const root = getRouteDescription('/');
    expect(getRouteDescription('/orchestrator')).toEqual(root);
    expect(getRouteDescription('/work')).toEqual(root);

    const designer = getRouteDescription('/designer');
    expect(getRouteDescription('/workflow-designer-neo')).toEqual(designer);
  });

  it('resolves each catalogued primary surface', () => {
    expect(getRouteDescription('/home')?.label).toBe('Home');
    expect(getRouteDescription('/team')?.label).toBe('Agents');
    expect(getRouteDescription('/chat')?.label).toBe('Chat');
    expect(getRouteDescription('/ledger')?.label).toBe('Activity Record');
    expect(getRouteDescription('/designer')?.label).toBe('Designer');
  });

  it('resolves advanced tool descriptors', () => {
    const tools = getRouteDescription('/tools');
    expect(tools?.label).toBe('Tools');
    expect(tools?.purpose).toMatch(/inventory|adapter|policy/i);

    const posture = getRouteDescription('/governance/posture');
    expect(posture?.label).toBe('Posture Dashboard');
    expect(posture?.purpose).toMatch(/signer|control|exception/i);
  });

  it('falls back to the parent tool for nested routes', () => {
    const controlsParent = getRouteDescription('/governance/controls');
    const controlsDetail = getRouteDescription('/governance/controls/ac-2');
    expect(controlsDetail).toEqual(controlsParent);
  });

  it('normalizes trailing slashes', () => {
    expect(getRouteDescription('/home/')).toEqual(getRouteDescription('/home'));
    expect(getRouteDescription('/tools/')).toEqual(getRouteDescription('/tools'));
  });

  it('returns null for unknown paths', () => {
    expect(getRouteDescription('/this/does/not/exist')).toBeNull();
    expect(getRouteDescription('/foo')).toBeNull();
  });

  it('treats empty / missing pathname as the root landing surface', () => {
    // location.pathname is always at least '/' in real React Router
    // usage, but guard the assistant dock against any transient empty
    // value rather than crashing or returning null.
    expect(getRouteDescription('')).toEqual(getRouteDescription('/'));
  });
});
